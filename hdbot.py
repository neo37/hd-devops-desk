#!/usr/bin/env python3
"""hdbot — Telegram-бот сервиса заявок DevOps (hd.py).

Что делает:
  * вход на страницу заявок: /start hd_<метка>, /login — ссылка {HD_PUBLIC}/?tg=<код>;
    без ника в Telegram просит поделиться контактом и запоминает телефон;
  * подписка на заявки: /start devops[_<метка>], «devops», /devops; «devops стоп» — отписка;
  * доставка: забирает HD_STATE/outbox/*.json ({text, to?}) и рассылает, файл — в outbox/sent/;
  * /request — режим новой заявки: текст, до 3 .md, пересланные сообщения;
    по «Готово» кладёт заявку в HD_STATE/inbox/, дальше её разбирает hd.py;
  * /hdwatch, /hdunwatch в топике группы — запись топика в HD_STATE/chatlog/ для робота hd.
    В группах бот отвечает только на эти команды, остальное молча пропускает.

Только стандартная библиотека, long polling, состояние в JSON-файлах.

Запуск:
  HD_BOT_TOKEN=123:abc HD_PUBLIC=https://hd.example.org python3 hdbot.py

Переменные окружения (см. hdbot.env.example):
  HD_BOT_TOKEN  токен бота (обязателен)
  HD_PUBLIC     адрес страницы заявок, по умолчанию http://localhost:8093
  HD_STATE      каталог данных hd.py, по умолчанию ./data
  HD_TG_STATE   каталог состояния бота, по умолчанию ./data/tg
  HD_TG_PROXY   HTTPS-прокси для api.telegram.org (необязательно)
"""
import base64
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

TOKEN = os.environ.get('HD_BOT_TOKEN', '')
PUBLIC = os.environ.get('HD_PUBLIC', 'http://localhost:8093').rstrip('/')
STATE = Path(os.environ.get('HD_STATE', './data'))
TG_STATE = Path(os.environ.get('HD_TG_STATE', './data/tg'))
PROXY = os.environ.get('HD_TG_PROXY', '')

LIMIT = 3900                 # длина одного сообщения Telegram с запасом
OUTBOX_EVERY = 5             # как часто смотреть outbox, секунд
MODE_TTL = 30 * 60           # режим заявки живёт 30 минут
MAX_FILES, MAX_FILE = 3, 100 * 1024
MARK = re.compile(r'[A-Za-z0-9_-]{8,56}')   # как tg_record() в hd.py

MODE_KB = {'keyboard': [[{'text': 'Готово'}, {'text': 'Отмена'}]], 'resize_keyboard': True}
NO_KB = {'remove_keyboard': True}
COMMANDS = [('request', 'Новая заявка DevOps'), ('login', 'Вход на страницу заявок'),
            ('devops', 'Получать заявки DevOps'), ('status', 'Что настроено')]

HELP = ('Бот заявок DevOps.\n'
        '/request — новая заявка: текст, файлы .md или пересланные сообщения;\n'
        '/login — вход на страницу заявок;\n'
        '/devops — получать новые заявки, «devops стоп» — отписаться;\n'
        '/status — что настроено.')
NO_NICK = ('У вас в Telegram нет ника (username) или он скрыт. Чтобы DevOps мог вам ответить, '
           'поделитесь контактом кнопкой ниже или заведите ник в настройках Telegram.')


def log(*a) -> None:
    print(time.strftime('%Y-%m-%d %H:%M:%S'), *a, file=sys.stderr, flush=True)


# --- состояние -------------------------------------------------------------------

def load(name: str, default, base: Path | None = None):
    try:
        return json.loads(((base or TG_STATE) / name).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default


def save(name: str, value, base: Path | None = None) -> None:
    path = (base or TG_STATE) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(path)


def full_name(u: dict) -> str:
    return ' '.join(x for x in (u.get('first_name'), u.get('last_name')) if x)


# --- Telegram API ----------------------------------------------------------------

def _opener():
    if PROXY:
        return urllib.request.build_opener(urllib.request.ProxyHandler({'https': PROXY, 'http': PROXY}))
    return urllib.request.build_opener()


OPENER = _opener()


def api(method: str, params: dict | None = None, timeout: int = 40) -> dict:
    req = urllib.request.Request(
        f'https://api.telegram.org/bot{TOKEN}/{method}',
        data=json.dumps(params or {}).encode(), headers={'Content-Type': 'application/json'})
    try:
        with OPENER.open(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode())
        except Exception:
            body = {'ok': False, 'description': str(exc)}
        log(f'{method}: {body.get("description")}')
        return body


def tg_download(file_id: str) -> bytes | None:
    info = api('getFile', {'file_id': file_id}).get('result') or {}
    if not info.get('file_path'):
        return None
    try:
        with OPENER.open(f'https://api.telegram.org/file/bot{TOKEN}/{info["file_path"]}', timeout=60) as r:
            return r.read()
    except Exception as exc:
        log('скачивание файла:', repr(exc))
        return None


def chunks(text: str) -> list[str]:
    """Разрезать по строкам на куски не длиннее LIMIT (слишком длинную строку — как есть по LIMIT)."""
    out, cur = [], ''
    for line in text.split('\n'):
        while len(line) > LIMIT:
            if cur:
                out.append(cur)
                cur = ''
            out.append(line[:LIMIT])
            line = line[LIMIT:]
        if cur and len(cur) + 1 + len(line) > LIMIT:
            out.append(cur)
            cur = line
        else:
            cur = f'{cur}\n{line}' if cur else line
    if cur.strip():
        out.append(cur)
    return out


def send(chat_id: int, text: str, markup: dict | None = None, thread: int | None = None) -> None:
    parts = chunks(text) or ['']
    for i, part in enumerate(parts):
        p = {'chat_id': chat_id, 'text': part, 'disable_web_page_preview': True}
        if thread:
            p['message_thread_id'] = thread
        if markup and i == len(parts) - 1:
            p['reply_markup'] = markup
        api('sendMessage', p)


def ensure_commands() -> None:
    """Добавить свои команды в меню, не затирая уже настроенные."""
    have = api('getMyCommands', {}).get('result') or []
    names = {c.get('command') for c in have}
    add = [{'command': c, 'description': d} for c, d in COMMANDS if c not in names]
    if add:
        api('setMyCommands', {'commands': have + add})


# --- подписка и вход -------------------------------------------------------------

def devops_subs() -> list[int]:
    out = []
    for x in load('devops.json', []):
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            pass
    return out


def devops_set(chat_id: int, on: bool) -> None:
    people = set(devops_subs())
    (people.add if on else people.discard)(chat_id)
    save('devops.json', sorted(people))


def known_phone(chat_id: int) -> str:
    """Телефон, которым человек уже делился: второй раз не спрашиваем."""
    for rec in load('devops-links.json', {}).values():
        if isinstance(rec, dict) and rec.get('chat_id') == chat_id and rec.get('phone'):
            return rec['phone']
    return ''


def set_pending(chat_id: int, mark: str) -> None:
    pending = load('hd-pending.json', {})
    pending[str(chat_id)] = mark
    save('hd-pending.json', pending)


def hd_link(chat_id: int, who: dict, mark: str = '', phone: str = '') -> str:
    """Записать, кто вошёл, и вернуть ссылку на страницу заявок с кодом входа."""
    phone = phone or ('' if who.get('username') else known_phone(chat_id))
    rec = {'chat_id': chat_id, 'username': who.get('username', ''), 'name': full_name(who),
           'phone': phone, 'at': int(time.time())}
    links = load('devops-links.json', {})
    code = secrets.token_urlsafe(12)
    links[code] = rec
    if mark:
        links[mark] = rec
    save('devops-links.json', links)
    return f'{PUBLIC}/?tg={code}'


def mark_of(arg: str, prefix: str) -> str:
    m = arg[len(prefix):] if arg.startswith(prefix) else ''
    return m if MARK.fullmatch(m) else ''


def ask_contact(chat_id: int) -> None:
    send(chat_id, NO_NICK, {'keyboard': [[{'text': 'Поделиться контактом', 'request_contact': True}]],
                            'one_time_keyboard': True, 'resize_keyboard': True})


def do_login(chat_id: int, who: dict, mark: str) -> None:
    if not who.get('username') and not known_phone(chat_id):
        set_pending(chat_id, mark)
        ask_contact(chat_id)
        return
    link = hd_link(chat_id, who, mark)
    send(chat_id, 'Вход выполнен. Вернитесь на страницу заявок: она обновится сама. '
                  'Или откройте ссылку (подойдёт и на другом устройстве):\n' + link)


def do_subscribe(chat_id: int, who: dict, mark: str) -> None:
    devops_set(chat_id, True)
    send(chat_id, 'Подписал на заявки DevOps: каждая новая заявка придёт сюда. «devops стоп» — отписаться.')
    if who.get('username') or known_phone(chat_id):
        send(chat_id, 'Ссылка для входа на страницу заявок (ник и имя подставятся сами):\n'
             + hd_link(chat_id, who, mark))
    else:
        set_pending(chat_id, mark)
        ask_contact(chat_id)


def handle_contact(msg: dict, chat_id: int) -> None:
    contact, who = msg.get('contact') or {}, msg.get('from') or {}
    if not contact.get('user_id') or contact.get('user_id') != who.get('id'):
        send(chat_id, 'Нужен ваш собственный контакт, кнопкой «Поделиться контактом».')
        return
    phone = '+' + str(contact.get('phone_number', '')).lstrip('+')
    pending = load('hd-pending.json', {})
    mark = pending.pop(str(chat_id), '')
    save('hd-pending.json', pending)
    link = hd_link(chat_id, who, mark, phone=phone)
    send(chat_id, 'Спасибо, вход выполнен. Вернитесь на страницу заявок: она обновится сама. '
                  'Или откройте ссылку:\n' + link, NO_KB)


def do_status(chat_id: int) -> None:
    sub = chat_id in devops_subs()
    mode = str(chat_id) in load('hd-mode.json', {})
    logged = any(isinstance(r, dict) and r.get('chat_id') == chat_id
                 for r in load('devops-links.json', {}).values())
    send(chat_id, '\n'.join([
        'Вход на страницу заявок: ' + ('был' if logged else 'нет (/login)'),
        'Заявки DevOps: ' + ('подписан' if sub else 'нет (/devops)'),
        'Режим новой заявки: ' + ('включён' if mode else 'выключен')]))


# --- режим новой заявки ----------------------------------------------------------

def fwd_origin(msg: dict) -> tuple[int | None, str]:
    """Автор пересланного сообщения: (id, имя). id нет, если он скрыл пересылку."""
    o = msg.get('forward_origin') or {}
    if o.get('type') == 'user':
        u = o.get('sender_user') or {}
        return u.get('id'), full_name(u)
    if o.get('type') == 'hidden_user':
        return None, o.get('sender_user_name', '')
    if msg.get('forward_from'):
        u = msg['forward_from']
        return u.get('id'), full_name(u)
    if msg.get('forward_sender_name'):
        return None, msg['forward_sender_name']
    return None, ''


def write_inbox(chat_id: int, item: dict) -> None:
    box = STATE / 'inbox'
    box.mkdir(parents=True, exist_ok=True)
    name = f'{chat_id}-{time.time_ns()}.json'
    tmp = box / f'.{name}'
    tmp.write_text(json.dumps(item, ensure_ascii=False), encoding='utf-8')
    tmp.replace(box / name)


def hd_mode(msg: dict, chat_id: int) -> bool:
    """True — сообщение обработано режимом заявки (или включило/выключило его)."""
    text = (msg.get('text') or '').strip()
    low = text.lower().split('@')[0]
    modes = load('hd-mode.json', {})
    key = str(chat_id)
    m = modes.get(key)
    if m and time.time() - m.get('since', 0) > MODE_TTL:
        modes.pop(key)
        save('hd-mode.json', modes)
        m = None
    if low in ('/request', 'заявка', 'новая заявка'):
        modes[key] = {'since': time.time(), 'texts': [], 'files': [], 'origin_id': None,
                      'origin_name': '', 'forwarded': False}
        save('hd-mode.json', modes)
        send(chat_id, 'Режим новой заявки. Пришлите текст и/или до 3 файлов .md (до 100 КБ) '
                      'или перешлите сюда сообщения участника. Когда всё отправлено, нажмите «Готово».\n\n'
                      'Пересланные сообщения станут заявкой от имени их автора: он должен был входить '
                      'на страницу заявок, а пересылать чужие могут подписчики DevOps.', MODE_KB)
        return True
    if not m:
        return False
    if low in ('готово', '/done'):
        modes.pop(key)
        save('hd-mode.json', modes)
        if not m['texts'] and not m['files']:
            send(chat_id, 'Ничего не прислано, заявку не создаю.', NO_KB)
            return True
        who = msg.get('from') or {}
        write_inbox(chat_id, {
            'forwarder': chat_id, 'forwarder_name': full_name(who),
            'origin_id': m['origin_id'] if m['forwarded'] else who.get('id'),
            'origin_name': m['origin_name'] if m['forwarded'] else full_name(who),
            'texts': m['texts'], 'files': m['files']})
        send(chat_id, 'Собираю заявку, поля заполнятся сами. Номер и ссылку пришлю отдельным сообщением.', NO_KB)
        return True
    if low in ('отмена', '/cancel'):
        modes.pop(key)
        save('hd-mode.json', modes)
        send(chat_id, 'Заявка отменена.', NO_KB)
        return True
    if text.startswith('/'):
        return False                      # прочие команды работают и в режиме заявки
    if msg.get('forward_origin') or msg.get('forward_from') or msg.get('forward_sender_name'):
        oid, oname = fwd_origin(msg)
        if m['forwarded'] and (m['origin_id'] != oid or (oid is None and m['origin_name'] != oname)):
            send(chat_id, 'В одной заявке — сообщения одного автора. Это сообщение от другого, пропускаю.')
            return True
        m.update(forwarded=True, origin_id=oid, origin_name=oname)
    doc = msg.get('document')
    if doc:
        name = doc.get('file_name') or 'файл'
        if not name.lower().endswith('.md'):
            send(chat_id, f'«{name}» пропускаю: принимаю только .md.')
        elif (doc.get('file_size') or 0) > MAX_FILE:
            send(chat_id, f'«{name}» больше 100 КБ, пропускаю.')
        elif len(m['files']) >= MAX_FILES:
            send(chat_id, 'Уже 3 файла, больше не принимаю.')
        else:
            data = tg_download(doc['file_id'])
            if data is None:
                send(chat_id, f'«{name}» не удалось скачать, пришлите ещё раз.')
            elif len(data) > MAX_FILE:
                send(chat_id, f'«{name}» больше 100 КБ, пропускаю.')
            else:
                m['files'].append({'name': name, 'b64': base64.b64encode(data).decode()})
                send(chat_id, f'Принял «{name}» ({len(m["files"])}/3).')
    elif msg.get('photo') or msg.get('video') or msg.get('voice') or msg.get('audio'):
        send(chat_id, 'Картинки и медиа в заявку не беру, только текст и .md. Подпись сохраню.')
    body = (msg.get('text') or msg.get('caption') or '').strip()
    if body:
        m['texts'].append(body[:12000])
        if len(m['texts']) == 1 and not doc:
            send(chat_id, 'Принял текст. Можно прислать ещё или нажать «Готово».')
    modes[key] = m
    save('hd-mode.json', modes)
    return True


# --- группы: чтение топика -------------------------------------------------------

def hd_group(msg: dict, chat_id: int) -> None:
    """Группы: только /hdwatch, /hdunwatch и запись отслеживаемого топика. Остальное — молча мимо."""
    thread = msg.get('message_thread_id') if msg.get('is_topic_message') else None
    key = f'{chat_id}_{thread or 0}'
    watches = load('hd-watch.json', [])
    text = (msg.get('text') or '').strip()
    cmd = text.split()[0].split('@')[0].lower() if text.startswith('/') else ''
    who = msg.get('from') or {}
    if cmd in ('/hdwatch', '/hdunwatch'):
        if int(who.get('id') or 0) not in devops_subs():
            send(chat_id, 'Включать и выключать чтение могут подписчики DevOps (команда /devops боту в личке).',
                 thread=thread)
        elif cmd == '/hdwatch':
            if key not in watches:
                save('hd-watch.json', watches + [key])
            send(chat_id, 'Читаю этот топик: по будням робот выписывает из него заявки в колонку '
                          '«Прочитано роботом». /hdunwatch — перестать.', thread=thread)
        else:
            save('hd-watch.json', [w for w in watches if w != key])
            send(chat_id, 'Больше не читаю этот топик.', thread=thread)
        return
    if key not in watches:
        return
    body = msg.get('text') or msg.get('caption') or ''
    doc = msg.get('document')
    if doc:
        body = f"[файл {doc.get('file_name', '')}] " + body
    if not body.strip():
        return
    reply = (msg.get('reply_to_message') or {}).get('message_id')
    rec = {'id': msg.get('message_id'), 'date': msg.get('date'), 'uid': who.get('id'),
           'username': who.get('username', ''), 'name': full_name(who), 'text': body[:8000],
           'reply_to': reply if reply and reply != thread else None}
    path = STATE / 'chatlog' / f'{key}.jsonl'
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')


# --- разбор сообщений ------------------------------------------------------------

def handle(msg: dict) -> None:
    chat = msg.get('chat') or {}
    chat_id = chat.get('id')
    if chat_id is None:
        return
    if chat.get('type') in ('group', 'supergroup'):
        hd_group(msg, chat_id)
        return
    if chat.get('type') != 'private':
        return
    if hd_mode(msg, chat_id):
        return
    if msg.get('contact'):
        handle_contact(msg, chat_id)
        return
    who = msg.get('from') or {}
    text = (msg.get('text') or '').strip()
    words = text.split()
    first = words[0].split('@')[0].lower() if words else ''
    arg = words[1] if len(words) > 1 else ''
    low = text.lower()
    if (first == '/start' and (arg == 'hd' or arg.startswith('hd_'))) or first == '/login' \
            or low in ('вход', 'войти'):
        do_login(chat_id, who, mark_of(arg, 'hd_'))
    elif low in ('devops стоп', 'devops stop', '/devops_stop', '/devops стоп'):
        devops_set(chat_id, False)
        send(chat_id, 'Отписал от заявок DevOps.')
    elif (first == '/start' and (arg == 'devops' or arg.startswith('devops_'))) \
            or low in ('devops', '/devops', 'заявки') or (first == '/devops' and len(words) == 1):
        do_subscribe(chat_id, who, mark_of(arg, 'devops_'))
    elif first == '/status' or low == 'статус':
        do_status(chat_id)
    elif text:
        send(chat_id, HELP)


# --- доставка из outbox ----------------------------------------------------------

def deliver_outbox() -> None:
    """Новые сообщения hd: с полем to — только им, иначе всем подписчикам.
    Без подписчиков файл тоже уходит в sent/, чтобы не копить пачку для первого подписчика."""
    box = STATE / 'outbox'
    if not box.is_dir():
        return
    sent = box / 'sent'
    sent.mkdir(exist_ok=True)
    for path in sorted(box.glob('*.json'), key=lambda x: x.stat().st_mtime):
        try:
            item = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        text = str(item.get('text') or '')
        people = item.get('to') or devops_subs()
        if text.strip():
            for cid in people:
                try:
                    send(int(cid), text)
                except Exception as exc:
                    log(f'доставка {cid}:', repr(exc))
        path.replace(sent / path.name)


# --- главный цикл ----------------------------------------------------------------

def main() -> None:
    if not TOKEN:
        sys.exit('нужен HD_BOT_TOKEN')
    TG_STATE.mkdir(parents=True, exist_ok=True)
    for d in ('outbox/sent', 'inbox', 'chatlog'):
        (STATE / d).mkdir(parents=True, exist_ok=True)
    try:
        ensure_commands()
    except Exception as exc:
        log('меню команд не настроено:', repr(exc))
    offset = int(load('offset.json', {}).get('offset', 0))
    last_box = 0.0
    log('бот запущен')
    while True:
        if time.time() - last_box >= OUTBOX_EVERY:
            last_box = time.time()
            try:
                deliver_outbox()
            except Exception as exc:
                log('outbox:', repr(exc))
        try:
            res = api('getUpdates', {'offset': offset, 'timeout': OUTBOX_EVERY,
                                     'allowed_updates': ['message']}, timeout=OUTBOX_EVERY + 15)
        except Exception as exc:
            log('getUpdates:', repr(exc))
            time.sleep(5)
            continue
        if not res.get('ok'):
            time.sleep(5)
            continue
        for upd in res.get('result') or []:
            offset = max(offset, int(upd.get('update_id', 0)) + 1)
            msg = upd.get('message')
            if msg:
                try:
                    handle(msg)
                except Exception as exc:
                    log('сообщение:', repr(exc))
            save('offset.json', {'offset': offset})


if __name__ == '__main__':
    main()
