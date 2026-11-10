/* Демо доски hd: подмена window.fetch вымышленными данными. Всё живёт в памяти вкладки.
 * Параметры адреса (для показа и скриншотов): ?theme=dark|light, ?view=3d|2d,
 * ?layout=arc|ribbon|carousel|cascade|urgency. */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  if (q.get('shot')) document.documentElement.classList.add('shot');
  try {
    if (q.get('theme')) localStorage.setItem('hd-theme', q.get('theme') === 'dark' ? 'dark' : 'light');
    if (q.get('view')) localStorage.setItem('hd-3d', q.get('view') === '3d' ? '1' : '0');
    if (q.get('layout')) localStorage.setItem('hd-3d-layout', JSON.stringify({ d: q.get('layout'), m: q.get('layout') }));
  } catch (_) {}

  const LABELS = {
    kind: { service: 'Новый сервис', stand: 'Стенд', access: 'Доступ', incident: 'Инцидент', other: 'Другое' },
    contour: { dev: 'Dev', stage: 'Stage', prod: 'Прод', vds: 'VDS', unknown: 'Согласовать' },
    urgency: { normal: 'Обычная', high: 'Высокая', fire: 'Горит' },
  };
  const P = {
    anna: ['Анна Смирнова', '@anna_dev'], igor: ['Игорь Петров', '@igor_p'], masha: ['Мария Ковалёва', '@masha_qa'],
    oleg: ['Олег Николаев', '@oleg_back'], dina: ['Дина Ахметова', '@dina_front'], sergey: ['Сергей Лебедев', '@s_lebedev'],
    pavel: ['Павел (DevOps)', '@pavel_ops'],
  };
  const C = (who, at, text) => ({ at, name: P[who][0], contact: P[who][1], text });
  let n = 0;
  const T = (id, status, who, created, title, o) => Object.assign({
    slug: id + '-demo' + String(++n).padStart(4, '0'), id, status, title, author: P[who][0], contact: P[who][1], created,
    kind: 'other', contour: 'dev', urgency: 'normal', due: '', to: 'DevOps', details: '', links: '',
    prev_status: 'done', opened: true, highlight: false, list: [], source: 'форма',
  }, o || {});

  const tasks = [
    T(141, 'draft', 'oleg', '10.11.2026 11:05', 'Поднять отдельный стенд для демо в четверг', {
      kind: 'stand', contour: 'stage', due: 'к четвергу', opened: false, source: 'топик DevOps (робот)',
      details: 'Олег в топике: «Нужен отдельный стенд под показ в четверг, чтобы никто не деплоил поверх».\n\nЧто сделать DevOps:\n1. Поднять копию stage из ветки release/2.4\n2. Залить обезличенные тестовые данные\n3. Закрыть стенд от автодеплоя до пятницы' }),
    T(140, 'draft', 'masha', '10.11.2026 10:20', 'Доступ к логам payments-api на stage', {
      kind: 'access', contour: 'stage', opened: false, source: 'топик DevOps (робот)',
      details: 'Мария просит доступ на чтение к логам payments-api на stage для разбора падающих автотестов.' }),
    T(139, 'draft', 'sergey', '10.11.2026 08:47', 'Ночной бэкап reports-db не отработал', {
      kind: 'incident', contour: 'vds', urgency: 'high', source: 'топик DevOps (робот)',
      details: 'Сергей: «В отчёте о бэкапах за ночь reports-db — ошибка, места на диске не хватило».\n\nЧто сделать DevOps:\n1. Проверить место на томе бэкапов\n2. Перезапустить бэкап вручную\n3. Поставить алерт на заполнение тома' }),
    T(138, 'new', 'anna', '10.11.2026 12:31', 'payments-api отдаёт 502 после деплоя на stage', {
      kind: 'incident', contour: 'stage', urgency: 'fire', due: 'сегодня', opened: false, highlight: true,
      details: 'Что случилось:\nПосле вчерашнего деплоя payments-api на stage отвечает 502 на /checkout. Блокирует тестирование оплаты.\n\nЧто сделать DevOps:\n1. Посмотреть логи и метрики payments-api на stage\n2. Откатить последний деплой, если причина в нём\n3. Отписаться в заявке, что нашли\n\nОткрытые вопросы:\n- Менялись ли переменные окружения в этом релизе?',
      links: 'https://git.example.test/shop/payments-api/-/merge_requests/412' }),
    T(137, 'new', 'igor', '10.11.2026 09:58', 'Развернуть search-service на dev', {
      kind: 'service', contour: 'dev', due: 'к пятнице',
      details: 'Зачем:\nНовый сервис полнотекстового поиска по каталогу, нужен фронту для интеграции.\n\nЧто сделать DevOps:\n1. Развернуть search-service на dev из ветки main\n2. Настроить CI/CD и переменные окружения (секреты передам отдельно)\n3. Прислать адрес и доступ к логам',
      links: 'https://git.example.test/shop/search-service' }),
    T(136, 'new', 'dina', '09.11.2026 17:12', 'Продлить TLS-сертификат для status-страницы', {
      kind: 'other', contour: 'prod', urgency: 'high', due: 'до 20.11',
      details: 'Сертификат status-страницы истекает 22.11. Нужно продлить и проверить автопродление.' }),
    T(135, 'new', 'dina', '09.11.2026 14:40', 'CI: кэш зависимостей для billing-ui', {
      kind: 'other', contour: 'dev',
      details: 'Сборка billing-ui идёт 14 минут, из них 9 — установка зависимостей. Хотим кэш между пайплайнами.' }),
    T(134, 'work', 'oleg', '08.11.2026 16:03', 'Перенести notify-worker на новую очередь', {
      kind: 'service', contour: 'stage', urgency: 'high', highlight: true,
      details: 'notify-worker нужно переключить на новый кластер очередей, старый выводим из работы.\n\nЧто сделать DevOps:\n1. Завести очередь и пользователя\n2. Переключить notify-worker на stage\n3. После проверки — то же на проде',
      list: [C('pavel', '09.11.2026 10:12', 'Очередь на stage завёл, переключаю воркер.'), C('oleg', '09.11.2026 10:40', 'Спасибо, проверю сегодня.')] }),
    T(133, 'work', 'masha', '07.11.2026 12:18', 'Отдельная БД для интеграционных тестов', {
      kind: 'stand', contour: 'dev',
      details: 'Интеграционные тесты мешают друг другу на общей БД. Нужна отдельная база, пересоздаваемая на каждый прогон.',
      list: [C('pavel', '08.11.2026 11:00', 'Сделаю через шаблонную базу, пересоздание займёт секунды.')] }),
    T(132, 'work', 'sergey', '06.11.2026 18:25', 'Алерты по месту на диске для vds-02', {
      kind: 'other', contour: 'vds', urgency: 'high',
      details: 'После истории с бэкапом нужны алерты: 80% — предупреждение, 90% — в топик DevOps.' }),
    T(131, 'done', 'igor', '05.11.2026 10:02', 'Доступ к реестру образов для нового разработчика', {
      kind: 'access', contour: 'dev', details: 'Новый разработчик в команде поиска, нужен pull/push в реестр образов dev.' }),
    T(130, 'done', 'anna', '04.11.2026 15:47', 'Ротация ключей хранилища для reports', {
      kind: 'access', contour: 'prod', urgency: 'high', details: 'Плановая ротация ключей объектного хранилища для сервиса reports.' }),
    T(129, 'done', 'oleg', '03.11.2026 13:20', 'Обновить базовый образ Python до 3.12', {
      kind: 'service', contour: 'dev', details: 'Обновить базовый образ и пересобрать сервисы, которые от него зависят.' }),
    T(128, 'done', 'dina', '02.11.2026 09:31', 'Превью-стенды для веток billing-ui', {
      kind: 'stand', contour: 'dev', details: 'Каждой ветке MR — свой превью-стенд, удаляется после слияния.' }),
    T(127, 'archived', 'masha', '28.10.2026 11:10', 'Почистить старые тестовые стенды', { kind: 'stand', contour: 'stage', prev_status: 'done', details: 'Удалить стенды старше месяца.' }),
    T(126, 'archived', 'igor', '27.10.2026 16:44', 'Перезапустить зависший пайплайн', { kind: 'incident', contour: 'dev', prev_status: 'done', details: 'Пайплайн висит в очереди второй час.' }),
    T(125, 'archived', 'sergey', '25.10.2026 10:05', 'Дубль: алерты по диску', { kind: 'other', contour: 'vds', prev_status: 'new', details: 'Дубль заявки №132.' }),
  ];
  const BOARD = ['draft', 'new', 'work', 'done'];
  const pub = t => Object.assign({}, t, { comments: t.list.length, list: undefined });
  const find = slug => tasks.find(t => t.slug === slug);

  const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const body = init => { try { return JSON.parse((init && init.body) || '{}'); } catch (_) { return {}; } };
  const realFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const p = url.pathname;
    if (!p.startsWith('/api/hd/')) return realFetch(input, init);
    await sleep(180);
    if (p === '/api/hd/tasks') {
      const arch = url.searchParams.get('archive') === '1';
      const list = tasks.filter(t => arch ? t.status === 'archived' : BOARD.includes(t.status)).sort((a, b) => b.id - a.id);
      return json(200, { can_move: true, tasks: list.map(pub), archived: tasks.filter(t => t.status === 'archived').length, labels: LABELS });
    }
    const b = body(init), t = find(String(b.slug || ''));
    if (p === '/api/hd/seen') { if (t) t.opened = true; return json(200, { ok: true }); }
    if (!t) return json(400, { error: 'нет такой заявки' });
    if (p === '/api/hd/tasks/move') {
      if (![...BOARD, 'archived', 'rejected'].includes(b.status)) return json(400, { error: 'нет такого статуса' });
      if (b.status === 'archived' && t.status !== 'archived') t.prev_status = t.status;
      t.status = b.status; t.opened = true;
      return json(200, { ok: true });
    }
    if (p === '/api/hd/tasks/edit') {
      const f = b.fields || {};
      if (!String(f.title || t.title).trim() || !String(f.details || t.details).trim()) return json(400, { error: 'заголовок и описание не могут быть пустыми' });
      ['title', 'kind', 'contour', 'urgency', 'to', 'due', 'details', 'links'].forEach(k => { if (k in f) t[k] = String(f[k]); });
      t.opened = true;
      return json(200, { ok: true });
    }
    if (p === '/api/hd/comment') {
      const text = String(b.text || '').trim();
      if (!text) return json(400, { error: 'пустой комментарий' });
      const c = { at: new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).replace(',', ''), name: P.pavel[0], contact: P.pavel[1], text };
      t.list.push(c); t.opened = true;
      return json(200, c);
    }
    return json(404, { error: 'не найдено' });
  };

  // Вместо страницы /r/<slug> — карточка заявки в диалоге (и для 2D, и для 3D-вида).
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STATUS = { draft: 'Прочитано роботом', new: 'Новая', work: 'В работе', done: 'Готово', archived: 'В архиве' };
  function view(slug) {
    const t = find(slug);
    if (!t) return;
    t.opened = true;
    let d = document.getElementById('demoView');
    if (!d) { d = document.createElement('dialog'); d.id = 'demoView'; document.body.appendChild(d); }
    const draw = () => {
      d.innerHTML = `<div class="dv"><h3>№${t.id} ${esc(t.title)}</h3>
        <p class="dv-m">${esc(t.author)} (${esc(t.contact)}) · ${esc(t.created)} · источник: ${esc(t.source)}</p>
        <div class="dv-tags"><span>${STATUS[t.status] || t.status}</span><span>${LABELS.kind[t.kind]}</span><span>контур ${LABELS.contour[t.contour]}</span>
          <span>срочность ${LABELS.urgency[t.urgency].toLowerCase()}</span>${t.due ? `<span>нужно ${esc(t.due)}</span>` : ''}</div>
        <pre>${esc(t.details)}</pre>${t.links ? `<h4>Ссылки</h4><pre>${esc(t.links)}</pre>` : ''}
        <h4>Комментарии</h4>${t.list.map(c => `<div class="dv-c"><i>${esc(c.name)} · ${esc(c.at)}</i>${esc(c.text)}</div>`).join('') || '<div class="dv-c"><i>Пока нет</i></div>'}
        <form class="dv-f" method="dialog"><input placeholder="Комментарий (в демо не сохраняется)" maxlength="500"><button class="btn primary" type="submit">Отправить</button></form>
        <div class="dv-a"><button class="btn ghost" type="button" data-close>Закрыть</button></div></div>`;
      d.querySelector('[data-close]').onclick = () => d.close();
      d.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        const inp = d.querySelector('input');
        if (!inp.value.trim()) return;
        await window.fetch('/api/hd/comment', { method: 'POST', body: JSON.stringify({ slug, text: inp.value }) });
        draw();
      };
    };
    draw();
    if (!d.open) d.showModal();
  }
  const slugOf = href => (String(href || '').match(/^\/r\/([\w-]+)$/) || [])[1];
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="/r/"]');
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    view(slugOf(a.getAttribute('href')));
  }, true);
  const realOpen = window.open.bind(window);
  window.open = (u, ...rest) => { const s = slugOf(u); if (s) { view(s); return null; } return realOpen(u, ...rest); };
})();
