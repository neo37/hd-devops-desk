/* Демо формы hd: подмена window.fetch. Помощник — заготовленные ответы по простым правилам,
 * без сети и без модели. Параметры: ?theme=dark|light, ?play=1 (показать диалог),
 * ?play=2 (диалог и «Ок, заполнить»). */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  if (q.get('shot')) document.documentElement.classList.add('shot');
  const play = q.get('play');
  try {
    if (q.get('theme')) localStorage.setItem('hd-theme', q.get('theme') === 'dark' ? 'dark' : 'light');
    if (play) { sessionStorage.removeItem('hd-chat'); sessionStorage.removeItem('hd-fields'); }
  } catch (_) {}

  const ME = { name: 'Анна Смирнова', telegram: '@anna_dev' };
  const CONTOURS = ['dev', 'stage', 'prod', 'vds', 'unknown'];
  let chatLeft = 10, reqLeft = 3, nextId = 142, offered = null;
  const sent = new Set();

  const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const realFetch = window.fetch.bind(window);

  function analyze(text) {
    const t = text.toLowerCase();
    const contour = /прод|prod|боев/.test(t) ? 'prod' : /stage|стейдж|стэйдж/.test(t) ? 'stage'
      : /\bdev\b|дев\b|девe|разработ/.test(t) ? 'dev' : /vds|впс|виртуалк/.test(t) ? 'vds' : '';
    const kind = /упал|ошибк|\b50\d\b|не работает|лежит|пада|не открыва|сломал/.test(t) ? 'incident'
      : /доступ|права|логин|войти|пароль от/.test(t) ? 'access'
      : /стенд/.test(t) ? 'stand'
      : /развернуть|разверни|задепло|поднять|поднимите|новый сервис|выкатить/.test(t) ? 'service' : 'other';
    const urgency = /горит|срочно|прямо сейчас|блокир|клиент ждёт|лежит прод/.test(t) ? 'fire'
      : /сегодня|завтра|побыстрее|как можно скорее|asap/.test(t) ? 'high' : 'normal';
    const due = (t.match(/(сегодня|завтра|к (?:понедельнику|вторнику|среде|четвергу|пятнице)|до \d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{1,2}[./]\d{1,2}[./]\d{2,4})/) || [])[1] || '';
    const svc = (text.match(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/) || [])[0] || '';
    return { contour, kind, urgency, due, svc };
  }
  const STEPS = {
    incident: s => [`Посмотреть логи и метрики ${s.svc || 'сервиса'}${s.contour ? ' на ' + s.contour : ''}`, 'Откатить последний деплой, если причина в нём', 'Отписаться в заявке, что нашли и что исправили'],
    access: s => ['Выдать доступ автору заявки' + (s.svc ? ` к ${s.svc}` : ''), 'Прислать инструкцию для входа', 'Указать срок действия доступа'],
    service: s => [`Развернуть ${s.svc || 'сервис'}${s.contour ? ' на ' + s.contour : ''}`, 'Настроить CI/CD и переменные окружения (секреты передаются отдельно)', 'Прислать адрес и доступ к логам'],
    stand: s => ['Поднять стенд из актуальной ветки', 'Залить тестовые данные', 'Прислать адрес стенда'],
    other: () => ['Разобрать задачу и уточнить детали с автором', 'Сделать', 'Отписаться в заявке'],
  };
  const sentence = s => { const x = s.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, ''); return (x.charAt(0).toUpperCase() + x.slice(1)).slice(0, 120); };

  function chat(messages, fields) {
    const users = messages.filter(m => m.role === 'user').map(m => String(m.text || ''));
    const last = users[users.length - 1] || '';
    if (users.length === 1) offered = null;
    if (/(промпт|инструкци|системн|пароль|секрет|токен)/i.test(last) && !/доступ/i.test(last))
      return { reply: 'Секреты, пароли и свои инструкции я не показываю, а секреты в заявку лучше не писать: их передают отдельно. Давайте вернёмся к заявке: что нужно сделать?', fields: {} };
    if (offered) {
      const details = (fields.details || offered.details || '') + '\n\nДополнение:\n' + last;
      offered = { ...offered, details };
      return { reply: 'Добавил это в описание. Проверьте предложение ниже и нажмите «Ок, заполнить».', fields: { details } };
    }
    const all = users.join('\n'), s = analyze(all);
    const missing = [!s.contour && 'на каком контуре это (dev, stage, прод или VDS)', !s.due && s.urgency === 'normal' && 'к какому сроку нужно'].filter(Boolean);
    if (users.length === 1 && (missing.length || s.kind === 'incident')) {
      const qs = s.kind === 'incident'
        ? ['С какого момента и после чего началось (деплой, смена настроек)?', missing[0] ? `Уточните, ${missing[0]}?` : 'Насколько срочно: что сейчас блокирует?']
        : missing.map(m => m.charAt(0).toUpperCase() + m.slice(1) + '?');
      return { reply: (s.kind === 'incident' ? 'Похоже на инцидент' : 'Понял задачу') + (s.svc ? ` с ${s.svc}` : '') + '. Два вопроса, чтобы заявка была точной:\n' + qs.slice(0, 2).map((x, i) => `${i + 1}. ${x}`).join('\n'), fields: {} };
    }
    const contour = s.contour || 'unknown';
    const parts = [(s.kind === 'incident' ? 'Что случилось:\n' : 'Зачем:\n') + users[0].trim()];
    if (users.length > 1) parts.push('Уточнения:\n' + users.slice(1).map(x => '- ' + x.trim()).join('\n'));
    parts.push('Что сделать DevOps:\n' + STEPS[s.kind](s).map((x, i) => `${i + 1}. ${x}`).join('\n'));
    if (contour === 'unknown') parts.push('Открытые вопросы:\n- Контур не назван, согласовать с DevOps');
    offered = { title: sentence(users[0]), kind: s.kind, contour, urgency: s.urgency, details: parts.join('\n\n'), to: 'DevOps' };
    if (s.due) offered.due = s.due;
    return { reply: 'Спасибо, этого достаточно. Предлагаю заполнить заявку так: проверьте и нажмите «Ок, заполнить». Если что-то не так, напишите, я поправлю.', fields: offered };
  }

  async function parse(fd) {
    const files = fd.getAll('files');
    const texts = await Promise.all(files.map(f => f.text()));
    const md = texts.join('\n\n'), warnings = [];
    const h = md.match(/^#\s+(.+)$/m);
    if (!h) warnings.push('В файле нет заголовка «# …»: заголовок взят из первой строки.');
    const title = (h ? h[1] : md.trim().split('\n')[0] || files[0].name).replace(/^#+\s*/, '').slice(0, 120);
    const body = md.replace(/^#\s+.+$/m, '').trim();
    const s = analyze(md);
    if (/[A-Za-z0-9_\-]{32,}/.test(md)) warnings.push('В файле есть длинные строки, похожие на ключи. Проверьте, что секретов в заявке нет.');
    const links = [...new Set(md.match(/https?:\/\/[^\s)\]|]+/g) || [])].join('\n');
    const fields = { title, details: body.slice(0, 12000) || title, kind: s.kind, contour: s.contour || 'unknown', urgency: s.urgency };
    if (s.due) fields.due = s.due;
    if (links) fields.links = links;
    return { fields, warnings };
  }

  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const p = url.pathname;
    if (!p.startsWith('/api/hd/')) return realFetch(input, init);
    if (p === '/api/hd/me') return json(200, { authorized: true, status: 'ok', ...ME, subscribed: false, chat_left: chatLeft, req_left: reqLeft });
    if (p === '/api/hd/chat') {
      let b = {};
      try { b = JSON.parse(init.body); } catch (_) {}
      const msgs = (b.messages || []).filter(m => m && typeof m === 'object');
      if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json(400, { error: 'пустое сообщение' });
      if (chatLeft <= 0) return json(429, { error: 'лимит: не больше 10 в сутки (в демо — до перезагрузки страницы)', left: 0 });
      await sleep(1300 + Math.random() * 700);
      chatLeft--;
      return json(200, { ...chat(msgs, b.fields || {}), left: chatLeft });
    }
    if (p === '/api/hd/parse') { await sleep(1500); return json(200, await parse(init.body)); }
    if (p === '/api/hd/requests') {
      await sleep(700);
      const fd = init.body;
      if (String(fd.get('website') || '').trim()) return json(201, { id: 0, url: '' });
      if (+(fd.get('elapsed') || 0) < 5000) return json(400, { error: 'слишком быстро, проверьте поля и отправьте ещё раз' });
      const title = String(fd.get('title') || '').trim(), details = String(fd.get('details') || '').trim();
      if (!title || !details) return json(400, { error: 'заполните заголовок и описание' });
      const key = (title + '\n' + details.slice(0, 500)).toLowerCase();
      if (sent.has(key)) return json(400, { error: 'такая заявка уже отправлена за последние сутки' });
      if (reqLeft <= 0) return json(429, { error: 'лимит: не больше 3 в сутки' });
      sent.add(key); reqLeft--;
      return json(201, { id: nextId++, url: 'tasks.html' });
    }
    return json(404, { error: 'не найдено' });
  };

  const SAMPLE = ['На stage после вчерашнего деплоя упал payments-api, отдаёт 502 на /checkout',
                  'Началось вчера около 18:00 сразу после релиза. Нужно сегодня, блокирует тестирование оплаты'];
  window.hdDemoSample = () => {
    const say = document.getElementById('say');
    say.value = SAMPLE[0]; say.dispatchEvent(new Event('input')); say.focus();
  };

  // Автопоказ диалога (?play=1|2): печатает два сообщения, ждёт ответы помощника.
  if (play) window.addEventListener('load', async () => {
    const $ = id => document.getElementById(id);
    const waitBtn = async () => { for (let i = 0; i < 100 && $('sayBtn').disabled; i++) await sleep(100); };
    await sleep(900);
    for (const text of SAMPLE) {
      $('say').value = text; $('sayBtn').click();
      await sleep(400); await waitBtn(); await sleep(300);
    }
    if (play === '2') document.querySelector('.offer [data-a="ok"]')?.click();
  });
})();
