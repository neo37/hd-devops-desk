# hd — сервис заявок DevOps

Небольшой самостоятельно разворачиваемый сервис заявок для команды DevOps. Человек пишет или надиктовывает, что случилось, а помощник задаёт уточняющие вопросы и предлагает поля заявки, которые заполняются только после «ок». Заявки попадают на доску команды и подписчикам в Telegram, а робот сам выписывает черновики из рабочего чата.

*A small self-hosted help desk for DevOps requests: AI-assisted request form, Telegram login, kanban board with a 3D view, a robot that reads the team chat, REST API and MCP server. Python standard library only, no database.*

**Демо:** https://neo37.github.io/hd-devops-desk/ — [доска](https://neo37.github.io/hd-devops-desk/demo/tasks.html) · [форма](https://neo37.github.io/hd-devops-desk/demo/form.html) (данные вымышлены, всё работает в браузере, изменения не сохраняются).

![Доска заявок](docs/img/board.png)

| Форма с помощником | 3D-вид доски |
|---|---|
| ![Форма](docs/img/form.png) | ![3D-вид](docs/img/board-3d.png) |

| Тёмная тема | Телефон: доска | Телефон: 3D-карусель | Телефон: форма |
|---|---|---|---|
| ![Тёмная тема](docs/img/board-dark.png) | ![Доска на телефоне](docs/img/mobile-board.png) | ![3D на телефоне](docs/img/mobile-3d.png) | ![Форма на телефоне](docs/img/mobile-form.png) |

## Возможности

**Форма «Что случилось?»**
- Чат с помощником: он задаёт не больше двух уточняющих вопросов за раз и предлагает поля. Поля заполняются только по кнопке «Ок, заполнить» (или ответу «ок»), заполненные подсвечиваются.
- Диктовка голосом (распознавание речи браузера: Chrome, Edge, Safari).
- До трёх `.md` файлов по 100 КБ: помощник разбирает их и предлагает поля. Если помощник недоступен, работает простой разбор прямо в браузере.
- Помощник — Claude Code CLI в режиме `claude -p` без встроенных инструментов. По желанию к нему подключается графовая память кода по MCP только на чтение, чтобы уточнять точные имена репозиториев, сервисов и ручек.
- Справка по инфраструктуре (`HD_INFRA`) подмешивается в промпт, строки, похожие на секреты, вырезаются.

**Вход и защита от спама**
- Вход только через Telegram-бота: ник и имя берутся из Telegram на сервере, подменить их из формы нельзя.
- Лимиты на пользователя: 3 заявки и 10 сообщений чата в сутки (скользящие 24 часа, счётчик на диске), плюс общие суточные потолки.
- Скрытое поле-ловушка, таймер заполнения формы (быстрее 5 секунд — отказ), отсев дубликатов за сутки.
- Новые пользователи могут писать сразу или после подтверждения в админке; бан.

**Доска `/tasks`**
- Колонки «Прочитано роботом → Новые → В работе → Готово».
- Перетаскивание мышью и пальцем (на тач-экране — после короткого удержания), правка карточки, комментарии, архив с возвратом в прежнюю колонку.
- Метка «не открыта»: заявку ещё не смотрел никто, кроме автора. Неоткрытые заявки раз в сутки напоминаются главному (`HD_REMIND_TO`).
- Подсветка «Топ-5», тёмная тема.
- 3D-вид (порт 3D-доски из Kaneo): CSS 3D-трансформации без WebGL и без зависимостей; раскладки «Дуга», «Лента», «Карусель», «Каскад», «По срочности» с плавными переездами, перелёт карточек при обновлении, на телефоне — карусель колонок и меню «Переместить в:» по долгому нажатию.

**Робот топика DevOps**
- Бот пишет сообщения отслеживаемого топика Telegram-группы в журнал. Раз в 45 минут по будням с 7 до 20 (МСК), если были новые сообщения и разговор затих, робот смотрит окно за неделю и заводит черновики в «Прочитано роботом». Рассылки нет: черновик ещё не заявка.

**Пересылка боту**
- Подписчик DevOps пересылает боту чужое сообщение или `.md` — заявка создаётся от имени автора пересланного сообщения.

**Админка `/admin`**
- Basic-авторизация, пароль хранится хешем, подбор ограничен 10 попытками в час с адреса.
- Заявки и статусы, пользователи (подтвердить, забанить), подписчики, режим «новые сразу могут писать», выпуск и отзыв API-ключей.
- Секретные доски (`/tasks<id>`): видны только с паролем админки, без рассылок, напоминаний и робота.

**API и MCP** — см. [ниже](#api-и-mcp).

## Архитектура

```
 форма /  ──┐                                ┌──> доска /tasks, карточка /r/<slug>
 топик TG ──┤                                │
 пересылка ─┼──> hd.py (HTTP, потоки) ───────┤
 REST / MCP ┘     │  claude -p (без инструментов)   └──> outbox/ ──> hdbot.py ──> Telegram
 hd.py new ───────┘  JSON-файлы в HD_STATE      <── inbox/, chatlog/, tg/ <──┘
```

- **`hd.py`** — один процесс на `http.server` (стандартная библиотека). Отдаёт форму, доску, админку, REST и MCP; в фоновых потоках разбирает входящие пересылки, запускает робота топика и напоминания.
- **`hdbot.py`** — Telegram-бот, единственный, кто опрашивает токен. Он и `hd.py` обмениваются файлами в каталоге данных: `outbox/` (что разослать), `inbox/` (пересланные сообщения), `chatlog/` (журнал топика), `tg/` (метки входа и подписчики).
- **Хранение** — без БД. Заявка — папка `requests/<номер>-<метка>/` с `request.json` и приложенными файлами; рядом `users.json`, `limits.json`, `apikeys.json`, `admin.json`, `settings.json`. Запись атомарная (временный файл + rename). Бэкап — копия каталога.
- **Фронтенд** — `index.html` (форма), `tasks.html` (доска), `board3d.js` (3D-вид): чистые HTML/CSS/JS без сборки.

## Установка

Нужно:
- Python 3.11+ (только стандартная библиотека, `pip install` не нужен);
- Telegram-бот (токен от @BotFather);
- опционально — [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) (`claude`) для помощника, разбора `.md` и робота. Без него форма работает: файлы разбираются простым правилом в браузере, а чат покажет ошибку вызова помощника.

```bash
git clone https://github.com/neo37/hd-devops-desk.git
cd hd-devops-desk
```

### Переменные окружения `hd.py`

| Переменная | По умолчанию | Что задаёт |
|---|---|---|
| `HD_STATE` | `./data` | Каталог данных: заявки, пользователи, лимиты, ключи, очереди бота |
| `HD_ADDR` | `127.0.0.1:8093` | Адрес и порт HTTP-сервера |
| `HD_PUBLIC` | `http://localhost:8093` | Публичный адрес сервиса: ссылки в Telegram, проверка `Origin` в админке, примеры в `/api` |
| `HD_TG_BOT` | `your_bot` | Имя бота без `@` для кнопок входа и подписки |
| `HD_TG_STATE` | `./data/tg` | Каталог, где бот хранит метки входа (`devops-links.json`) и подписчиков (`devops.json`) |
| `CLAUDE_BIN` | `claude` | Путь к Claude Code CLI |
| `HD_MODEL` | `claude-opus-5` | Модель помощника формы и разбора `.md` |
| `HD_WATCH_MODEL` | `claude-sonnet-4-6` | Модель робота топика (читает много текста — подойдёт модель дешевле) |
| `HD_CLAUDE_ENV` | — | Файл, из которого берётся только `CLAUDE_CODE_OAUTH_TOKEN` для агента |
| `HD_MCP_CONFIG` | — | MCP-конфиг графовой памяти кода (codebase-memory); из неё разрешены только чтения |
| `HD_GRAPH_CWD` | `.` | Рабочий каталог, в котором запускается агент |
| `HD_AGENT_TIMEOUT` | `240` | Таймаут одного вызова агента, секунды |
| `HD_INFRA` | `infra-brief.md` рядом с `hd.py` | Справка по инфраструктуре для помощника и робота; строки, похожие на секреты, отбрасываются |
| `HD_CONTOURS` | `{"dev": "Dev", "stage": "Stage", "prod": "Прод", "vds": "VDS", "unknown": "Согласовать"}` | Контуры (окружения) в JSON: значение → подпись |
| `HD_REQ_PER_USER` | `3` | Заявок в сутки на пользователя |
| `HD_REQ_TOTAL` | `50` | Заявок в сутки на всех |
| `HD_CHAT_PER_USER` | `10` | Сообщений чата в сутки на пользователя |
| `HD_CHAT_TOTAL` | `300` | Сообщений чата в сутки на всех |
| `HD_PARSE_PER_USER` | `10` | Разборов `.md` в сутки на пользователя |
| `HD_SECRET_BOARDS` | `{}` | Секретные доски в JSON: `{"211": "Название"}` → `/tasks211` |
| `HD_WATCH_EVERY` | `2700` | Как часто робот смотрит топик, секунды (45 минут) |
| `HD_WATCH_SETTLE` | `180` | Сколько секунд тишины в топике ждать перед разбором |
| `HD_REMIND_TO` | — | Telegram chat id через запятую: кому напоминать о неоткрытых заявках |
| `HD_REMIND_AFTER` | `7200` | Через сколько секунд неоткрытая заявка попадает в напоминание |

Агент запускается с `HOME=/root`: его учётные данные Claude Code ищутся там, либо токен передаётся через `HD_CLAUDE_ENV`.

### Переменные окружения `hdbot.py`

Пример — `hdbot.env.example`.

| Переменная | По умолчанию | Что задаёт |
|---|---|---|
| `HD_BOT_TOKEN` | — | Токен Telegram-бота от @BotFather (обязателен) |
| `HD_PUBLIC` | `http://localhost:8093` | Адрес `hd.py`, на него ведут ссылки входа |
| `HD_STATE` | `./data` | Каталог данных `hd.py` (`outbox/`, `inbox/`, `chatlog/`) — тот же, что у сервиса |
| `HD_TG_STATE` | `./data/tg` | Состояние бота (`devops.json`, `devops-links.json` и др.), его же читает `hd.py` |
| `HD_TG_PROXY` | — | HTTPS-прокси для `api.telegram.org`, если он недоступен напрямую, например `http://user:pass@proxy.example.org:3128` |

Бот и `hd.py` должны видеть одни и те же `HD_STATE` и `HD_TG_STATE`, поэтому удобно держать общие переменные в одном env-файле для обоих.

## Запуск

```bash
export HD_STATE=/var/lib/hd
export HD_TG_STATE=/var/lib/hd/tg
export HD_PUBLIC=https://hd.example.com
export HD_TG_BOT=my_hd_bot

# пароль админки (не короче 8 символов): читается из stdin, на диск пишется только хеш
printf '%s\n' 'пароль' | python3 hd.py admin-pass devops

python3 hd.py                         # сервис
HD_BOT_TOKEN=... python3 hdbot.py     # бот, отдельным процессом
```

Заявку можно поставить и из командной строки — например, из скрипта или агента:

```bash
python3 hd.py new --title "Развернуть search-service на dev" \
  --details "Нужен фронту для интеграции" --contact "@anna_dev" --file brief.md
```

### systemd

`/etc/hd.env` (права `600`):

```ini
HD_STATE=/var/lib/hd
HD_TG_STATE=/var/lib/hd/tg
HD_ADDR=127.0.0.1:8093
HD_PUBLIC=https://hd.example.com
HD_TG_BOT=my_hd_bot
HD_BOT_TOKEN=123456:ABC...
```

`/etc/systemd/system/hd.service`:

```ini
[Unit]
Description=hd — сервис заявок DevOps
After=network-online.target

[Service]
EnvironmentFile=/etc/hd.env
WorkingDirectory=/opt/hd
ExecStart=/usr/bin/python3 /opt/hd/hd.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/hdbot.service`:

```ini
[Unit]
Description=hd — Telegram-бот
After=network-online.target

[Service]
EnvironmentFile=/etc/hd.env
WorkingDirectory=/opt/hd
ExecStart=/usr/bin/python3 /opt/hd/hdbot.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now hd hdbot
```

### Caddy

`hd.py` слушает только `127.0.0.1`; наружу его выставляет reverse proxy с TLS. Адрес клиента берётся из `X-Forwarded-For` (Caddy его передаёт), от него зависят лимиты попыток входа в админку.

```caddyfile
hd.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8093
}
```

## API и MCP

Ключ выпускает администратор в `/admin` (раздел «API и MCP ключи»). Ключ показывается один раз, на диске хранится только его SHA-256. Права ключа: `can_move` (двигать, править, комментировать) и список секретных досок. Документация на самом сервисе — `/api`.

### REST `/api/v1`

```
GET  /api/v1/tasks?status=new|work|done|draft|archived[&board=…]
GET  /api/v1/tasks/<slug>
POST /api/v1/tasks                 {"title","details","kind","contour","urgency","due","links","to","draft":false}
POST /api/v1/tasks/<slug>/move     {"status":"work","comment":""}
POST /api/v1/tasks/<slug>/edit     {"fields":{"title":"…"}}
POST /api/v1/tasks/<slug>/comments {"text":"…"}
```

```bash
curl -H "Authorization: Bearer $HD_KEY" "https://hd.example.com/api/v1/tasks?status=new"

curl -X POST -H "Authorization: Bearer $HD_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Развернуть search-service на dev","details":"Нужен фронту","kind":"service","contour":"dev"}' \
  https://hd.example.com/api/v1/tasks
```

`kind`: `service | stand | access | incident | other`; `urgency`: `normal | high | fire`; `contour` — ключи из `HD_CONTOURS`. `draft: true` — черновик без рассылки.

### MCP `/mcp`

Streamable HTTP (JSON-RPC), тот же Bearer-ключ:

```bash
claude mcp add --transport http hd https://hd.example.com/mcp --header "Authorization: Bearer hd_…"
```

Инструменты: `hd_list_tasks`, `hd_get_task`, `hd_create_task`, `hd_move_task`, `hd_comment`.

## Безопасность

- **Агент без инструментов.** Помощник запускается как `claude -p --tools ""`: у него нет ни диска, ни shell. Из MCP разрешены только чтения графа кода. Текст из формы, `.md` и чата — данные, а не инструкции: промпт прямо запрещает выполнять просьбы из них, а даже «уговоренный» агент не может ничего прочитать или выполнить на машине.
- **Секреты не уходят агенту.** Из справки по инфраструктуре вырезаются строки, похожие на пароли, токены и ключи; разбор `.md` предупреждает о похожих на ключи строках.
- **Ключи и пароли — только хешем.** API-ключи хранятся как SHA-256 и сравниваются за постоянное время; пароль админки — PBKDF2-SHA256 с солью в `admin.json` (`600`), подбор ограничен.
- **Личность из Telegram.** Автор и контакт заявки с формы берутся из Telegram на сервере, а не из полей.
- **Не коммитьте секреты.** Каталог данных (`HD_STATE`), env-файлы, токен бота, `CLAUDE_CODE_OAUTH_TOKEN` и справку по инфраструктуре держите вне репозитория. В заявки секреты тоже не пишут — форма об этом напоминает.
- Наружу сервис выставляйте только через reverse proxy с TLS.

## Демо на GitHub Pages

Каталог `docs/` — лендинг и живое демо: `docs/demo/tasks.html` и `docs/demo/form.html` — копии `tasks.html` и `index.html` с подменённым `window.fetch` и вымышленными данными (`demo-board.js`, `demo-form.js`). В настройках репозитория: Pages → Deploy from a branch → `main` / `docs`.

Параметры демо для показа и скриншотов: `?theme=dark|light`, `?view=3d|2d`, `?layout=arc|ribbon|carousel|cascade|urgency` (доска), `?play=1|2` (форма: автопоказ диалога), `?shot=1` (без прелоадера и анимаций).

## Лицензия

MIT, см. [LICENSE](LICENSE).

3D-вид доски (`board3d.js`) — порт 3D-доски из [Kaneo](https://github.com/usekaneo/kaneo), MIT License, Copyright (c) 2024 Andrej Acevski. Спасибо автору Kaneo.
