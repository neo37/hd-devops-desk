/*!
 * board3d.js — 3D-вид канбан-доски hd (/tasks)
 *
 * Источник: форк Kaneo github.com/neo37/kaneo, ветка feat/3d-board-view
 * (коммит 54d0de1f), файл apps/web/src/components/kanban-board-3d/KanbanBoard3D.tsx
 * (коммиты ab54428a «3D board view with camera controls», e2e7281b «review feedback»)
 * и демо ветки gh-pages (d24464ac, index.html). Перенесено с React/Tailwind
 * на чистый JS без сборки и зависимостей; раскладки, карусель для телефона,
 * перенос карточек и анимации (FLIP) — наши доработки.
 * Kaneo: MIT License, Copyright (c) 2024 Andrej Acevski.
 *
 * Как и в оригинале, сцена — CSS 3D transforms (perspective + preserve-3d),
 * без WebGL и без внешних библиотек.
 *
 * API:
 *   const b = Board3D.mount(container,
 *     { columns:[[status,title],...], tasks:[...], canMove:bool, theme:'light'|'dark',
 *       labels:{contour:{},urgency:{}}, layout?:'arc'|'ribbon'|'carousel'|'cascade'|'urgency' },
 *     { onMove(slug,status){}, onOpen(slug){} });
 *   b.update(data); b.setLayout(name); b.getLayout(); b.reset(); b.destroy();
 * Задача: {slug,id,title,author,contact,created,urgency,contour,status,comments,opened,highlight}
 * Выбор раскладки хранится в localStorage 'hd-3d-layout' как {"d":"arc","m":"carousel"}
 * (отдельно для десктопа и телефона). Если браузер не умеет CSS 3D — mount()
 * бросает Error с code='NO_3D'.
 */
(function (global) {
  'use strict';

  // константы из KanbanBoard3D.tsx
  const P = 1200, CW = 300, GAP = 60;
  const Z_MIN = -10000, Z_MAX = -200, RX_LIMIT = 80;

  const LAYOUTS = ['arc', 'ribbon', 'carousel', 'cascade', 'urgency'];
  const LAYOUT_TITLES = { arc: 'Дуга', ribbon: 'Лента', carousel: 'Карусель', cascade: 'Каскад', urgency: 'По срочности' };
  const URGENCY = [['fire', 'Горит'], ['high', 'Высокая'], ['normal', 'Обычная']];
  const LS_KEY = 'hd-3d-layout';
  const DUR = 600, EASE = 'cubic-bezier(.2,.8,.2,1)';
  const LONG_PRESS = 420;

  const STYLE_ID = 'board3d-style';
  const ACC_SOFT = 'rgba(255,87,34,.28)', ACC_GLOW = 'rgba(255,87,34,.35)';
  const CSS = `
.b3d{position:relative;width:100%;overflow:hidden;perspective:${P}px;cursor:grab;user-select:none;-webkit-user-select:none;
  -webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;touch-action:none;background:var(--bg,#F5F5F5);
  border-radius:12px;font:400 15px/1.4 "Fira Sans",Arial,sans-serif;color:var(--ink,#050819)}
.b3d.carousel{touch-action:pan-y}
.b3d.grabbing{cursor:grabbing}
.b3d-world{position:absolute;inset:0;transform-style:preserve-3d;transition:transform .1s ease-out;pointer-events:none}
.b3d.anim .b3d-world{transition:transform ${DUR}ms ${EASE}}
.b3d-board{position:absolute;top:50%;left:50%;transform-style:preserve-3d}
.b3d-col{pointer-events:auto;position:absolute;left:0;top:0;width:${CW}px;max-height:560px;display:flex;flex-direction:column;
  border-radius:12px;border:1px solid var(--line,#E0E0E8);background:var(--col,#ECECF3);box-shadow:0 20px 50px rgba(5,8,25,.18);
  transform-style:preserve-3d;backface-visibility:hidden;-webkit-backface-visibility:hidden;outline:2px dashed transparent;
  transition:transform ${DUR}ms ${EASE},opacity .45s ease,outline-color .15s,background .15s}
.b3d.live .b3d-col{transition:outline-color .15s,background .15s}
.b3d.instant .b3d-col,.b3d.instant .b3d-world{transition:none!important}
.b3d[data-theme="dark"] .b3d-col{box-shadow:0 20px 50px rgba(0,0,0,.5)}
.b3d.carousel .b3d-col.focus{box-shadow:0 26px 60px rgba(5,8,25,.26)}
.b3d.carousel .b3d-col:not(.focus){cursor:pointer}
.b3d-col[data-status="draft"]{background:repeating-linear-gradient(135deg,var(--col,#ECECF3),var(--col,#ECECF3) 10px,var(--brand-soft,#E7E7F0) 10px,var(--brand-soft,#E7E7F0) 11px)}
.b3d-col.over{outline-color:var(--brand,#343A7E);background:var(--brand-soft,#E7E7F0)}
.b3d-col h2{flex-shrink:0;display:flex;align-items:center;gap:8px;margin:0;padding:10px 12px;font:600 14px "Fira Sans",Arial,sans-serif;
  color:var(--head,var(--brand,#343A7E));border-bottom:1px solid var(--line,#E0E0E8)}
.b3d-col h2 .n{margin-left:auto;font-size:11px;font-weight:500;color:var(--muted,#85868A);background:var(--card,#fff);
  border:1px solid var(--line,#E0E0E8);border-radius:5px;padding:1px 7px}
.b3d-col.col-in{animation:b3d-colin .5s ease both}
.b3d-list{min-height:0;flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px;touch-action:pan-y;overscroll-behavior:contain}
.b3d-card{background:var(--card,#fff);border:1px solid var(--line,#E0E0E8);border-left:4px solid var(--line,#E0E0E8);border-radius:10px;
  padding:10px 12px;cursor:pointer;text-align:left;box-shadow:0 1px 2px rgba(5,8,25,.06);color:var(--ink,#050819);
  font:400 15px/1.4 "Fira Sans",Arial,sans-serif;transition:border-color .15s,transform .15s,background .15s;outline:none;flex-shrink:0}
.b3d-card:hover,.b3d-card:focus-visible{border-color:var(--brand,#343A7E);transform:translateZ(14px)}
.b3d-card.u-high,.b3d-card.u-high:hover,.b3d-card.u-high:focus-visible{border-left-color:#FF9800}
.b3d-card.u-fire,.b3d-card.u-fire:hover,.b3d-card.u-fire:focus-visible{border-left-color:var(--err,#C62828)}
.b3d-card.hot{border-width:2px 2px 2px 4px;border-top-color:var(--accent,#FF5722);border-right-color:var(--accent,#FF5722);
  border-bottom-color:var(--accent,#FF5722);padding:9px 11px 9px 12px;
  box-shadow:0 0 0 3px ${ACC_SOFT},0 6px 24px ${ACC_GLOW};
  box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#FF5722) 28%,transparent),0 6px 24px color-mix(in srgb,var(--accent,#FF5722) 35%,transparent)}
.b3d-card.hot:not(.u-high):not(.u-fire){border-left-color:var(--accent,#FF5722)}
.b3d-col[data-status="draft"] .b3d-card{border-style:dashed;border-left-style:solid}
.b3d-card.movable{cursor:grab}.b3d-card.ghost{opacity:.35}
.b3d-card.pressed{border-color:var(--brand,#343A7E);box-shadow:0 0 0 2px var(--brand,#343A7E)}
.b3d-card.enter{animation:b3d-in .45s ${EASE} both}
.b3d-card .num{font-size:11px;color:var(--muted,#85868A);margin-bottom:2px;display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.b3d-card .t{font-size:14px;font-weight:500;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.b3d-card .m{color:var(--muted,#85868A);font-size:12px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.b3d-card .unseen,.b3d-card .top5{display:inline-block;font-size:11px;font-weight:500;color:var(--accent,#FF5722);border:1px solid var(--accent,#FF5722);
  border-radius:100px;padding:0 6px;line-height:1.45}
.b3d-card .top5{background:var(--accent,#FF5722);color:#fff;font-weight:600}
.b3d-empty{color:var(--muted,#85868A);font-size:13px;text-align:center;padding:16px 6px}
.b3d-bar{position:absolute;top:10px;left:10px;right:10px;z-index:3;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;
  touch-action:pan-x;pointer-events:none}
.b3d-bar::-webkit-scrollbar,.b3d-dots::-webkit-scrollbar{display:none}
.b3d-bar button,.b3d-dots button{pointer-events:auto;flex-shrink:0;font:500 12px "Fira Sans",Arial,sans-serif;color:var(--muted,#85868A);
  background:var(--card,#fff);border:1px solid var(--line,#E0E0E8);border-radius:7px;padding:4px 10px;cursor:pointer;min-height:28px}
.b3d-bar button:hover,.b3d-dots button:hover{color:var(--brand,#343A7E);border-color:var(--brand,#343A7E)}
.b3d-bar button[aria-pressed="true"]{background:var(--brand,#343A7E);border-color:var(--brand,#343A7E);color:var(--on-brand,#fff)}
.b3d-bar [data-reset]{margin-left:auto}
.b3d-hint{position:absolute;left:12px;top:46px;z-index:2;font-size:11px;color:var(--muted,#85868A);pointer-events:none;
  background:var(--card,#fff);border:1px solid var(--line,#E0E0E8);border-radius:7px;padding:4px 9px;opacity:.9;max-width:calc(100% - 24px)}
.b3d-dots{position:absolute;left:0;right:0;bottom:10px;z-index:3;display:none;justify-content:center;gap:6px;padding:0 10px;
  overflow-x:auto;scrollbar-width:none;touch-action:pan-x;pointer-events:none}
.b3d.carousel .b3d-dots{display:flex}
.b3d-dots button{display:inline-flex;align-items:center;gap:6px;border-radius:100px;flex-shrink:1;min-width:0}
.b3d-dots button i{width:8px;height:8px;border-radius:50%;background:var(--line,#E0E0E8);flex-shrink:0}
.b3d-dots button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.b3d-dots button b{font-weight:500;opacity:.8}
.b3d-dots button.on{color:var(--brand,#343A7E);border-color:var(--brand,#343A7E);flex-shrink:0}
.b3d-dots button.on i{background:var(--brand,#343A7E)}
.b3d-m .b3d-bar{pointer-events:auto}
.b3d-m .b3d-bar button{min-height:44px;font-size:14px;padding:0 14px;border-radius:10px}
.b3d-m .b3d-dots{pointer-events:auto;justify-content:flex-start}
.b3d-m .b3d-dots button{min-height:44px;font-size:14px;padding:0 12px;flex-shrink:0}
.b3d-m .b3d-dots button:not(.on) span{max-width:4.6em}
.b3d-m .b3d-col{box-shadow:0 8px 24px rgba(5,8,25,.14)}
.b3d-m .b3d-col h2{font-size:16px;padding:10px 14px;min-height:48px}
.b3d-m .b3d-col h2 .n{font-size:14px}
.b3d-m .b3d-list{overscroll-behavior:auto;gap:10px}
.b3d-m .b3d-card{padding:12px 14px}
.b3d-m .b3d-card.hot{padding:11px 13px 11px 14px}
.b3d-m .b3d-card .t{font-size:16px}
.b3d-m .b3d-card .m,.b3d-m .b3d-card .num,.b3d-m .b3d-card .unseen,.b3d-m .b3d-card .top5{font-size:14px}
.b3d-m .b3d-empty{font-size:14px}
.b3d-fx{position:fixed;left:0;top:0;width:0;height:0;z-index:1000;pointer-events:none;color:var(--ink,#050819)}
.b3d-fly,.b3d-drag{position:fixed!important;left:0;top:0;margin:0;pointer-events:none;transform-origin:0 0;will-change:transform}
.b3d-fly{box-shadow:0 12px 30px rgba(5,8,25,.22)}
.b3d-fly.hot{box-shadow:0 0 0 3px ${ACC_SOFT},0 10px 30px ${ACC_GLOW}}
.b3d-drag{transform:rotate(2deg);box-shadow:0 10px 30px rgba(5,8,25,.25);opacity:.95}
.b3d-backdrop{position:fixed;inset:0;pointer-events:auto;background:rgba(5,8,25,.3);display:flex;align-items:flex-end;justify-content:center;
  padding:12px 12px calc(12px + env(safe-area-inset-bottom));animation:b3d-fade .18s ease both;touch-action:none}
.b3d-menu{width:min(380px,100%);background:var(--card,#fff);color:var(--ink,#050819);border-radius:14px;padding:8px;
  box-shadow:0 20px 50px rgba(5,8,25,.3);display:flex;flex-direction:column;gap:4px;font:400 16px/1.3 "Fira Sans",Arial,sans-serif}
.b3d-menu-h{font-size:14px;color:var(--muted,#85868A);padding:8px 10px 4px}
.b3d-menu-h b{color:var(--ink,#050819);font-weight:500}
.b3d-menu button{min-height:48px;font:500 16px "Fira Sans",Arial,sans-serif;text-align:left;padding:0 14px;border:0;border-radius:10px;
  background:var(--brand-soft,#E7E7F0);color:var(--brand,#343A7E);cursor:pointer}
.b3d-menu-row{display:flex;gap:6px;margin-top:4px}
.b3d-menu-row button{flex:1;text-align:center;background:none;border:1px solid var(--line,#E0E0E8)}
@keyframes b3d-in{from{opacity:0;transform:translate3d(0,18px,-60px)}}
@keyframes b3d-colin{from{opacity:0}}
@keyframes b3d-fade{from{opacity:0}}
@media (prefers-reduced-motion:reduce){.b3d *,.b3d .b3d-world,.b3d-fx *{transition:none!important;animation:none!important}}
`;

  let styleRefs = 0;
  function addStyle() {
    styleRefs++;
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function dropStyle() {
    styleRefs = Math.max(0, styleRefs - 1);
    if (styleRefs) return;
    const s = document.getElementById(STYLE_ID);
    if (s) s.remove();
  }

  function supports3D() {
    const c = global.CSS;
    return !!(c && c.supports && c.supports('transform-style', 'preserve-3d') && c.supports('perspective', '1px'));
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mq = q => { try { return global.matchMedia(q).matches; } catch (_) { return false; } };

  function loadLayout(mobile) {
    let v = null;
    try { v = global.localStorage.getItem(LS_KEY); } catch (_) {}
    if (v) {
      if (LAYOUTS.indexOf(v) >= 0) return v;
      try { const o = JSON.parse(v); const x = o && o[mobile ? 'm' : 'd']; if (LAYOUTS.indexOf(x) >= 0) return x; } catch (_) {}
    }
    return mobile ? 'carousel' : 'arc';
  }
  function saveLayout(mobile, name) {
    try {
      let o = {};
      try { o = JSON.parse(global.localStorage.getItem(LS_KEY)) || {}; } catch (_) {}
      if (typeof o !== 'object') o = {};
      o[mobile ? 'm' : 'd'] = name;
      global.localStorage.setItem(LS_KEY, JSON.stringify(o));
    } catch (_) {}
  }

  function mount(container, data, handlers) {
    if (!container || !container.appendChild) throw new Error('Board3D.mount: нужен DOM-контейнер');
    if (!supports3D()) {
      const e = new Error('Board3D: браузер не поддерживает CSS 3D-трансформации — покажите 2D-доску');
      e.code = 'NO_3D';
      throw e;
    }
    handlers = handlers || {};
    data = data || {};
    addStyle();

    const rm = mq('(prefers-reduced-motion: reduce)');
    const autoHeight = container.clientHeight < 200;
    const root = document.createElement('div');
    root.className = 'b3d';
    root.setAttribute('data-board3d-viewport', '');
    root.innerHTML =
      '<div class="b3d-world" data-board3d-world><div class="b3d-board"></div></div>' +
      '<div class="b3d-bar" role="toolbar" aria-label="Раскладка 3D-доски">' +
      LAYOUTS.map(l => `<button type="button" data-layout="${l}" aria-pressed="false">${LAYOUT_TITLES[l]}</button>`).join('') +
      '<button type="button" data-reset title="Вернуть камеру">Сброс</button></div>' +
      '<div class="b3d-hint"></div><div class="b3d-dots" role="tablist" aria-label="Колонки"></div>';
    container.appendChild(root);
    const fx = document.createElement('div');
    fx.className = 'b3d-fx';
    document.body.appendChild(fx);
    const world = root.querySelector('.b3d-world');
    const board = root.querySelector('.b3d-board');
    const bar = root.querySelector('.b3d-bar');
    const hint = root.querySelector('.b3d-hint');
    const dots = root.querySelector('.b3d-dots');

    const st = { columns: [], tasks: [], canMove: false, labels: null };
    const colEls = new Map();   // ключ группы -> {el, list, title, count, empty, status, key}
    const cardEls = new Map();  // slug -> {el, sig}
    const flights = new Set();
    const timers = new Set();
    let mobile = isMobile();
    let layout = LAYOUTS.indexOf(data.layout) >= 0 ? data.layout : loadLayout(mobile);
    let focus = 0, cam = null, alive = true, animT = 0;

    function later(fn, ms) { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; }
    function cancelLater(t) { if (t) { clearTimeout(t); timers.delete(t); } }

    function isMobile() {
      const w = (root && root.clientWidth) || container.clientWidth || global.innerWidth;
      return w < 700 || mq('(pointer: coarse)');
    }
    function sizeRoot() {
      if (!autoHeight) { root.style.height = '100%'; return; }
      root.style.height = mobile ? 'max(460px, 76vh)' : 'max(420px, 70vh)';
      if (mobile) root.style.height = 'max(460px, 76svh)';   // если svh не поддержан — останется vh
    }

    // ---------- данные и группы ----------
    const isUrg = () => layout === 'urgency';
    const movable = () => st.canMove && !isUrg();
    const statusTitle = s => { const c = st.columns.find(c => c[0] === s); return c ? c[1] : s; };
    function groups() {
      if (isUrg()) {
        const L = (st.labels && st.labels.urgency) || {};
        return URGENCY.map(u => ({ key: 'u:' + u[0], title: L[u[0]] || u[1], value: u[0], status: null }));
      }
      return st.columns.map(c => ({ key: 's:' + c[0], title: c[1], value: c[0], status: c[0] }));
    }
    function tasksOf(g) {
      if (!isUrg()) return st.tasks.filter(t => t.status === g.value);
      const order = st.columns.map(c => c[0]);
      const u = t => (URGENCY.some(x => x[0] === t.urgency) ? t.urgency : 'normal');
      return st.tasks.filter(t => u(t) === g.value)
        .map((t, i) => ({ t, i, o: order.indexOf(t.status) }))
        .sort((a, b) => (a.o - b.o) || (a.i - b.i)).map(x => x.t);
    }
    function applyData(d) {
      d = d || {};
      if (d.columns) st.columns = d.columns.slice();
      if (d.tasks) st.tasks = d.tasks.map(t => Object.assign({}, t));
      if ('canMove' in d) st.canMove = !!d.canMove;
      if (d.labels) st.labels = d.labels;
      const theme = d.theme || document.documentElement.getAttribute('data-theme') || 'light';
      root.setAttribute('data-theme', theme);
      fx.setAttribute('data-theme', theme);
    }

    function cardContent(t) {
      const L = st.labels || {};
      const contour = (L.contour && L.contour[t.contour]) || t.contour || '';
      const second = isUrg() ? statusTitle(t.status) : ((L.urgency && L.urgency[t.urgency]) || '');
      const meta2 = [contour, second, t.comments ? 'комментариев: ' + t.comments : ''].filter(Boolean).join(' · ');
      return '<div class="num">№' + esc(t.id) +
        (t.highlight ? '<span class="top5">Топ-5</span>' : '') +
        (t.opened === false ? '<span class="unseen">не открыта</span>' : '') + '</div>' +
        '<div class="t">' + esc(t.title) + '</div>' +
        '<div class="m">' + esc(t.author || t.contact || '') + (t.created ? ' · ' + esc(t.created) : '') + '</div>' +
        (meta2 ? '<div class="m">' + esc(meta2) + '</div>' : '');
    }
    function cardFor(t) {
      let c = cardEls.get(t.slug);
      if (!c) {
        const el = document.createElement('div');
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.dataset.slug = t.slug;
        c = { el, sig: '' };
        cardEls.set(t.slug, c);
      }
      const html = cardContent(t);
      const cls = 'b3d-card u-' + (t.urgency || 'normal') + (t.highlight ? ' hot' : '') + (movable() ? ' movable' : '');
      const sig = cls + '|' + html;
      if (sig !== c.sig) {
        const keep = ['enter', 'ghost', 'pressed'].filter(k => c.el.classList.contains(k));
        c.el.className = cls + (keep.length ? ' ' + keep.join(' ') : '');
        c.el.innerHTML = html;
        c.sig = sig;
      }
      return c;
    }
    function makeCol(g) {
      const el = document.createElement('section');
      el.className = 'b3d-col';
      el.innerHTML = '<h2><span class="ttl"></span><span class="n"></span></h2>' +
        '<div class="b3d-list" data-board3d-scroll><div class="b3d-empty">—</div></div>';
      board.appendChild(el);
      return { el, list: el.querySelector('.b3d-list'), title: el.querySelector('.ttl'),
        count: el.querySelector('.n'), empty: el.querySelector('.b3d-empty'), isNew: true };
    }

    // приводит DOM к данным, переиспользуя элементы колонок и карточек
    function reconcile() {
      const gs = groups(), keep = new Set(), placed = new Set();
      gs.forEach((g, i) => {
        let c = colEls.get(g.key);
        if (!c) { c = makeCol(g); colEls.set(g.key, c); }
        keep.add(g.key);
        c.key = g.key; c.idx = i; c.status = g.status;
        c.el.dataset.key = g.key;
        c.el.dataset.status = g.status || 'u-' + g.value;
        c.title.textContent = g.title;
        const items = tasksOf(g);
        c.count.textContent = items.length;
        items.forEach((t, j) => {
          const ce = cardFor(t);
          placed.add(t.slug);
          const at = c.list.children[j];
          if (at !== ce.el) c.list.insertBefore(ce.el, at || c.empty);
        });
        while (c.list.children[items.length] && c.list.children[items.length] !== c.empty) c.list.children[items.length].remove();
        c.empty.style.display = items.length ? 'none' : '';
      });
      colEls.forEach((c, k) => { if (!keep.has(k)) { c.el.remove(); colEls.delete(k); } });
      cardEls.forEach((c, slug) => { if (!placed.has(slug)) { c.el.remove(); cardEls.delete(slug); } });
    }

    // ---------- геометрия раскладок ----------
    function geom() {
      const W = root.clientWidth || 800, H = root.clientHeight || 600, m = mobile;
      const cw = m ? clamp(W - 84, 220, 380) : CW;
      if (m && layout === 'carousel') return { W, H, m, cw, top: -H / 2 + 62, maxH: Math.max(220, H - 62 - 70) };
      return { W, H, m, cw, top: m ? -240 : -150, maxH: 560 };
    }
    function carouselStep(g) { return g.m ? 57 : 34; }   // на телефоне соседи выглядывают по краям ~20px
    function colPos(i, n, g) {
      const pitch = g.cw + GAP, total = n * g.cw + (n - 1) * GAP, off = i - (n - 1) / 2;
      switch (layout) {
        case 'ribbon':
          return { x: i * pitch - total / 2, y: g.top, z: 0, a: 0, r: 0, o: 1 };
        case 'cascade':   // лесенка: слева спереди-снизу → справа вглубь-вверх
          return { x: off * g.cw * 0.8 - g.cw / 2, y: g.top - off * 44, z: -i * 300 + (n - 1) * 150, a: -6, r: 0, o: 1 };
        case 'carousel': {
          const step = carouselStep(g);
          const R = g.m ? g.cw * 1.08 : (pitch / 2) / Math.sin(step * Math.PI / 360);
          const a = (i - focus) * step, aa = Math.abs(a);
          return { x: -g.cw / 2, y: g.top, z: -R, a, r: R, o: aa > 110 ? 0 : aa > 75 ? 1 - (aa - 75) / 35 : 1 };
        }
        default:          // arc и urgency — дуга из Kaneo
          return { x: i * pitch - total / 2, y: g.top, z: -Math.abs(off) * 40, a: -off * 6, r: 0, o: 1 };
      }
    }
    function placeColumns() {
      const gs = groups(), n = gs.length, g = geom();
      const f = Math.round(clamp(focus, 0, Math.max(0, n - 1)));
      gs.forEach((grp, i) => {
        const c = colEls.get(grp.key);
        if (!c) return;
        const p = colPos(i, n, g);
        c.el.style.width = g.cw + 'px';
        c.el.style.maxHeight = g.maxH + 'px';
        c.el.style.transform = `translate3d(${p.x}px,${p.y}px,${p.z}px) rotateY(${p.a}deg) translateZ(${p.r}px)`;
        c.el.style.opacity = p.o;
        c.el.style.pointerEvents = p.o < 0.3 ? 'none' : '';
        c.el.classList.toggle('focus', layout === 'carousel' && i === f);
      });
      renderDots();
    }
    function defaultCamera() {
      const g = geom(), n = Math.max(1, groups().length);
      const total = n * g.cw + (n - 1) * GAP;
      const fit = (w, k) => Math.round(clamp(P - P / clamp(g.W * k / w, 0.1, 0.95), -9000, Z_MAX));
      switch (layout) {
        case 'ribbon': return { x: 0, y: 0, z: fit(total, 0.9), rx: 0, ry: 0 };
        case 'carousel': return g.m ? { x: 0, y: 0, z: 0, rx: 0, ry: 0 } : { x: 0, y: 0, z: fit(g.cw * 2.8, 0.9), rx: 6, ry: 0 };
        case 'cascade': return { x: 0, y: -30, z: fit(total * 0.75, 0.8) - 350, rx: 10, ry: -10 };
        default: return { x: 0, y: 0, z: fit(total, 0.78), rx: 12, ry: -18 };
      }
    }
    function applyCamera(animate) {
      if (animate && !rm) {
        root.classList.add('anim');
        cancelLater(animT);
        animT = later(() => root.classList.remove('anim'), DUR + 80);
      }
      world.style.transform = `translate3d(${-cam.x}px,${-cam.y}px,${cam.z}px) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg)`;
    }

    // ---------- элементы управления ----------
    function syncChrome() {
      root.classList.toggle('carousel', layout === 'carousel');
      root.classList.toggle('b3d-m', mobile);
      fx.classList.toggle('b3d-m', mobile);
      bar.querySelectorAll('[data-layout]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === layout)));
      hint.hidden = mobile;
      hint.textContent = (layout === 'carousel' ? 'тянуть: листать колонки' : 'тянуть: панорама') +
        ' · ctrl/ПКМ: вращение · колесо: зум' + (movable() ? ' · карточку: перенос' : '') + ' · клик: открыть';
    }
    function renderDots() {
      if (layout !== 'carousel') { if (dots.firstChild) dots.innerHTML = ''; return; }
      const gs = groups(), f = Math.round(clamp(focus, 0, gs.length - 1));
      const html = gs.map((g, i) => `<button type="button" role="tab" data-i="${i}" aria-selected="${i === f}" class="${i === f ? 'on' : ''}">` +
        `<i></i><span>${esc(g.title)}</span><b>${tasksOf(g).length}</b></button>`).join('');
      if (dots.innerHTML !== html) dots.innerHTML = html;
      const on = dots.querySelector('.on');
      if (on && mobile && dots.scrollWidth > dots.clientWidth) {
        dots.scrollLeft = on.offsetLeft - (dots.clientWidth - on.offsetWidth) / 2;
      }
    }
    function setFocus(i) {
      const n = groups().length;
      focus = clamp(Math.round(i), 0, Math.max(0, n - 1));
      placeColumns();
    }

    // ---------- анимации: FLIP через «летающие» копии ----------
    function measure() {
      const m = new Map();
      cardEls.forEach((c, slug) => {
        if (!c.el.isConnected) return;
        const r = c.el.getBoundingClientRect();
        if (r.width > 1) m.set(slug, { r, col: c.el.closest('.b3d-col') });
      });
      return m;
    }
    function onScreen(r) { return r.bottom > 0 && r.right > 0 && r.top < global.innerHeight && r.left < global.innerWidth; }
    function fly(el, from, to) {
      const ow = el.offsetWidth;
      if (!ow || !el.animate || (!onScreen(from) && !onScreen(to))) return;
      const c = el.cloneNode(true);
      c.classList.remove('enter', 'ghost', 'pressed');
      c.classList.add('b3d-fly');
      c.style.width = ow + 'px';
      c.style.animationDelay = '';
      fx.appendChild(c);
      el.style.opacity = '0';
      const a = c.animate([
        { transform: `translate(${from.left}px,${from.top}px) scale(${from.width / ow})` },
        { transform: `translate(${to.left}px,${to.top}px) scale(${to.width / ow})` }
      ], { duration: DUR, easing: EASE, fill: 'both' });
      flights.add(a);
      let t = 0;
      const done = () => { cancelLater(t); flights.delete(a); c.remove(); el.style.opacity = ''; };
      a.onfinish = done; a.oncancel = done;
      t = later(done, DUR + 400);   // страховка, если анимация приостановлена (фоновая вкладка)
    }
    function shift(el, from, to) {   // сдвиг внутри той же колонки
      const dy = to.top - from.top;
      if (Math.abs(dy) < 2 || !el.animate || !to.height) return;
      const local = dy * (el.offsetHeight / to.height);
      const a = el.animate([{ transform: `translateY(${-local}px)` }, { transform: 'none' }], { duration: 400, easing: EASE });
      flights.add(a);
      a.onfinish = a.oncancel = () => flights.delete(a);
    }
    function animateFrom(firstM, override) {
      if (!firstM) return;
      void root.offsetWidth;
      const lastM = measure();
      lastM.forEach((l, slug) => {
        const el = cardEls.get(slug).el;
        const f = override && override.slug === slug ? { r: override.rect, col: null } : firstM.get(slug);
        if (!f) { el.classList.add('enter'); return; }
        if (f.col !== l.col) fly(el, f.r, l.r);
        else shift(el, f.r, l.r);
      });
    }
    function stagger() {
      if (rm) return;
      let k = 0;
      groups().forEach((g, i) => {
        const c = colEls.get(g.key);
        c.el.classList.add('col-in');
        c.el.style.animationDelay = i * 60 + 'ms';
        Array.prototype.forEach.call(c.list.querySelectorAll('.b3d-card'), el => {
          el.classList.add('enter');
          el.style.animationDelay = Math.min(k++ * 35, 900) + 120 + 'ms';
        });
      });
      // страховка: если animationend не пришёл (вкладка в фоне и т.п.) — показать конечное состояние
      later(() => root.querySelectorAll('.enter,.col-in').forEach(el => onAnimEnd({ target: el })), Math.min(k * 35, 900) + 120 + 900);
    }
    function onAnimEnd(ev) {
      const t = ev.target;
      if (t.classList && (t.classList.contains('enter') || t.classList.contains('col-in'))) {
        t.classList.remove('enter', 'col-in');
        t.style.animationDelay = '';
      }
    }

    // полное обновление с FLIP (данные или перенос)
    function refresh(override) {
      const firstM = rm ? null : measure();
      reconcile();
      placeColumns();
      syncChrome();
      animateFrom(firstM, override);
    }

    function setLayout(name, opts) {
      opts = opts || {};
      if (LAYOUTS.indexOf(name) < 0) throw new Error('Board3D.setLayout: неизвестная раскладка ' + name);
      if (opts.save !== false) saveLayout(mobile, name);
      if (name === layout) { cam = defaultCamera(); applyCamera(!rm); return; }
      const regroup = (name === 'urgency') !== isUrg();
      closeMenu();
      if (rm || opts.animate === false) {
        layout = name; reconcile(); placeColumns(); syncChrome(); cam = defaultCamera(); applyCamera(false);
        return;
      }
      if (!regroup) {   // те же колонки: CSS-переходы позиций колонок и камеры
        layout = name;
        cam = defaultCamera();
        applyCamera(true);
        reconcile(); placeColumns(); syncChrome();
        return;
      }
      // смена группировки (статус ↔ срочность): мгновенно ставим конечную сцену,
      // карточки перелетают из старых мест, новые колонки проявляются
      const firstM = measure();
      root.classList.add('instant');
      layout = name;
      reconcile(); placeColumns(); syncChrome();
      cam = defaultCamera(); applyCamera(false);
      void root.offsetWidth;
      colEls.forEach(c => { if (c.isNew) { c.el.classList.add('col-in'); c.isNew = false; } });
      animateFrom(firstM);
      root.classList.remove('instant');
    }

    // ---------- указатель: камера, свайп карусели, перенос ----------
    const pointers = new Map();
    let pinch = null, press = null, gest = null, move = null, menu = null, edge = null, suppressClick = false;

    function clearPress() {
      if (press) { cancelLater(press.timer); press.card.classList.remove('pressed'); }
      press = null;
    }
    function buzz() { try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {} }
    function capture(id) { try { root.setPointerCapture(id); } catch (_) {} }
    function swipePx() { return mobile ? geom().cw * 0.85 : 300; }

    function startGesture(ev, x, y, target) {
      const rotate = ev.button === 2 || ev.ctrlKey || ev.shiftKey;
      gest = { mode: layout === 'carousel' && !rotate ? 'swipe' : rotate ? 'rotate' : 'pan',
        lastX: x, lastY: y, startX: x, startY: y, startFocus: focus, moved: false, target,
        samples: [{ t: performance.now(), f: focus }] };
      capture(ev.pointerId);
      if (gest.mode === 'swipe') root.classList.add('live');
      root.classList.add('grabbing');
    }

    function onDown(ev) {
      if (ev.target.closest('.b3d-bar,.b3d-dots') || menu) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 2) {
        clearPress();
        if (move) endCardMove(false);
        if (gest && gest.mode === 'swipe') { root.classList.remove('live'); setFocus(focus); }
        gest = null;
        if (layout === 'carousel' && mobile) return;
        const ps = Array.from(pointers.values());
        pinch = { dist: dist(ps[0], ps[1]), mx: (ps[0].x + ps[1].x) / 2, my: (ps[0].y + ps[1].y) / 2 };
        return;
      }
      if (pointers.size > 2) return;
      const card = ev.target.closest('.b3d-card');
      if (card && root.contains(card) && !(ev.pointerType === 'mouse' && ev.button !== 0)) {
        const p = press = { id: ev.pointerId, card, x: ev.clientX, y: ev.clientY, type: ev.pointerType, moved: false, armed: false, timer: 0 };
        if (movable() && ev.pointerType !== 'mouse') {
          p.timer = later(() => {
            if (press !== p || p.moved) return;
            p.armed = true;
            capture(p.id);   // чтобы отпускание пальца пришло к нам, а не к меню
            buzz();
            openMenu(p.card);
          }, LONG_PRESS);
        }
        return;
      }
      startGesture(ev, ev.clientX, ev.clientY, ev.target);
    }

    function onMove(ev) {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && pointers.size >= 2) {
        const ps = Array.from(pointers.values());
        const d = dist(ps[0], ps[1]), mx = (ps[0].x + ps[1].x) / 2, my = (ps[0].y + ps[1].y) / 2;
        if (pinch.dist > 0 && d > 0) cam.z = clamp(cam.z + (d - pinch.dist) * 6, Z_MIN, Z_MAX);
        cam.ry += (mx - pinch.mx) * 0.3;
        cam.rx = clamp(cam.rx - (my - pinch.my) * 0.3, -RX_LIMIT, RX_LIMIT);
        pinch.dist = d; pinch.mx = mx; pinch.my = my;
        applyCamera(false);
        return;
      }
      if (move) { ev.preventDefault(); dragTo(ev.clientX, ev.clientY); return; }
      if (press && press.id === ev.pointerId) {
        const dx0 = ev.clientX - press.x, dy0 = ev.clientY - press.y;
        if (Math.abs(dx0) + Math.abs(dy0) < 8) return;
        const p = press;
        p.moved = true;
        clearPress();
        if (p.armed || (movable() && p.type === 'mouse')) {
          closeMenu();
          startCardMove(p, ev.clientX, ev.clientY);
          capture(ev.pointerId);
          return;
        }
        startGesture(ev, p.x, p.y, p.card);
      }
      if (!gest) return;
      const dx = ev.clientX - gest.lastX, dy = ev.clientY - gest.lastY;
      if (Math.abs(ev.clientX - gest.startX) + Math.abs(ev.clientY - gest.startY) > 4) gest.moved = true;
      if (gest.mode === 'swipe') {
        const n = groups().length;
        let f = gest.startFocus - (ev.clientX - gest.startX) / swipePx();
        if (f < 0) f *= 0.35;
        if (f > n - 1) f = n - 1 + (f - (n - 1)) * 0.35;
        focus = f;
        placeColumns();
        const now = performance.now();
        gest.samples.push({ t: now, f });
        while (gest.samples.length > 2 && now - gest.samples[0].t > 120) gest.samples.shift();
      } else if (gest.mode === 'pan') {
        const s = (P - cam.z) / P;
        cam.x -= dx * s; cam.y -= dy * s;
        applyCamera(false);
      } else {
        cam.ry += dx * 0.3;
        cam.rx = clamp(cam.rx - dy * 0.3, -RX_LIMIT, RX_LIMIT);
        applyCamera(false);
      }
      gest.lastX = ev.clientX; gest.lastY = ev.clientY;
    }

    function settle() {   // снап с инерцией
      const s = gest.samples, a = s[0], b = s[s.length - 1];
      const v = b.t > a.t ? (b.f - a.f) / (b.t - a.t) : 0;   // колонок в мс
      setFocus(focus + clamp(v * 250, -2, 2));
    }

    function onUp(ev) {
      const cancel = ev.type === 'pointercancel';
      if (!pointers.has(ev.pointerId)) return;
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      if (move) {
        endCardMove(!cancel, ev.clientX, ev.clientY);
        suppressClick = true;
      } else if (press && press.id === ev.pointerId) {
        const p = press;
        if (p.armed) { press = null; cancelLater(p.timer); }   // меню остаётся открытым
        else {
          clearPress();
          if (!cancel && !p.moved) { suppressClick = true; tapCard(p.card); }
        }
      } else if (gest) {
        root.classList.remove('live');
        if (gest.mode === 'swipe') {
          if (gest.moved || cancel) settle();
          else tapColumn(gest.target);
        }
        if (gest.moved) suppressClick = true;
      }
      if (!pointers.size) { gest = null; root.classList.remove('grabbing', 'live'); }
      later(() => { suppressClick = false; }, 0);
    }

    function colIndexOf(node) {
      const col = node && node.closest ? node.closest('.b3d-col') : null;
      const c = col && colEls.get(col.dataset.key);
      return c ? c.idx : -1;
    }
    function tapColumn(target) {
      const i = colIndexOf(target);
      if (i >= 0 && layout === 'carousel') setFocus(i);
    }
    function tapCard(card) {
      if (layout === 'carousel') {
        const i = colIndexOf(card);
        if (i >= 0 && i !== Math.round(focus)) { setFocus(i); return; }
      }
      if (handlers.onOpen) handlers.onOpen(card.dataset.slug);
    }

    function startCardMove(p, x, y) {
      const card = p.card;
      const ghost = card.cloneNode(true);
      ghost.classList.remove('enter', 'pressed');
      ghost.classList.add('b3d-drag');
      ghost.style.width = Math.max(200, Math.min(300, card.offsetWidth)) + 'px';
      ghost.style.animationDelay = '';
      fx.appendChild(ghost);
      card.classList.add('ghost');
      move = { card, slug: card.dataset.slug, ghost, over: null, x, y };
      root.classList.add('grabbing');
      if (p.type !== 'mouse') buzz();
      dragTo(x, y);
    }
    function colAt(x, y) {
      const el = document.elementFromPoint(x, y);
      const col = el && el.closest ? el.closest('.b3d-col') : null;
      return col && root.contains(col) ? col : null;
    }
    function stopEdge() { if (edge) { cancelLater(edge.t); edge = null; } }
    function dragTo(x, y) {
      move.x = x; move.y = y;
      move.ghost.style.left = (x - 20) + 'px';
      move.ghost.style.top = (y - 16) + 'px';
      const col = colAt(x, y);
      if (move.over !== col) {
        if (move.over) move.over.classList.remove('over');
        if (col) col.classList.add('over');
        move.over = col;
      }
      // у края экрана карусель листается сама
      if (layout !== 'carousel') return;
      const r = root.getBoundingClientRect(), zone = mobile ? 40 : 60;
      const dir = x < r.left + zone ? -1 : x > r.right - zone ? 1 : 0;
      if (dir === (edge ? edge.dir : 0)) return;
      stopEdge();
      if (!dir) return;
      const tick = () => {
        if (!move) return stopEdge();
        setFocus(Math.round(focus) + dir);
        edge.t = later(tick, 750);
      };
      edge = { dir, t: later(tick, 450) };
    }
    function endCardMove(commit, x, y) {
      stopEdge();
      const m = move;
      move = null;
      const rect = m.ghost.getBoundingClientRect();
      m.ghost.remove();
      m.card.classList.remove('ghost');
      if (m.over) m.over.classList.remove('over');
      root.classList.remove('grabbing');
      if (!commit) return;
      const px = x == null ? m.x : x, py = y == null ? m.y : y;
      const col = colAt(px, py);
      let c = col && colEls.get(col.dataset.key);
      if (!c && layout === 'carousel') {   // в карусели бросок в любое место сцены — в колонку в фокусе
        const r = root.getBoundingClientRect();
        if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
          const g = groups()[Math.round(clamp(focus, 0, groups().length - 1))];
          c = g && colEls.get(g.key);
        }
      }
      if (!c || !c.status) return;
      moveTask(m.slug, c.status, { slug: m.slug, rect });
    }
    function moveTask(slug, status, override) {
      const t = st.tasks.find(x => x.slug === slug);
      if (!t || t.status === status) return;
      t.status = status;   // оптимистично; хост подтверждает через update()
      refresh(override);
      if (handlers.onMove) handlers.onMove(slug, status);
    }

    // ---------- меню «Переместить в:» (долгое нажатие) ----------
    function onMenuKey(ev) { if (ev.key === 'Escape') closeMenu(); }
    function openMenu(card) {
      closeMenu();
      const slug = card.dataset.slug, t = st.tasks.find(x => x.slug === slug);
      if (!t) return;
      card.classList.add('pressed');
      const wrap = document.createElement('div');
      wrap.className = 'b3d-backdrop';
      wrap.innerHTML = '<div class="b3d-menu" role="dialog" aria-label="Переместить задачу">' +
        `<div class="b3d-menu-h">№${esc(t.id)} <b>${esc(t.title)}</b><br>Переместить в:</div>` +
        st.columns.filter(c => c[0] !== t.status).map(c => `<button type="button" data-to="${esc(c[0])}">${esc(c[1])}</button>`).join('') +
        '<div class="b3d-menu-row"><button type="button" data-open>Открыть</button><button type="button" data-cancel>Отмена</button></div></div>';
      fx.appendChild(wrap);
      const opened = Date.now();
      wrap.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) { if (e.target === wrap && Date.now() - opened > 350) closeMenu(); return; }
        if (b.dataset.to) {
          const r = card.getBoundingClientRect();
          closeMenu();
          moveTask(slug, b.dataset.to, { slug, rect: r });
        } else if (b.hasAttribute('data-open')) {
          closeMenu();
          if (handlers.onOpen) handlers.onOpen(slug);
        } else closeMenu();
      });
      document.addEventListener('keydown', onMenuKey);
      menu = { wrap, card };
      const first = wrap.querySelector('button');
      if (first && first.focus) try { first.focus({ preventScroll: true }); } catch (_) {}
    }
    function closeMenu() {
      if (!menu) return;
      menu.wrap.remove();
      menu.card.classList.remove('pressed');
      document.removeEventListener('keydown', onMenuKey);
      menu = null;
    }

    // ---------- прочие события ----------
    function onTouchMove(ev) {   // после долгого нажатия палец тащит карточку, а не прокручивает
      if (move || (press && press.armed)) ev.preventDefault();
    }
    function onClick(ev) { if (suppressClick) { ev.preventDefault(); ev.stopPropagation(); } }
    function onKey(ev) {
      const card = ev.target.closest && ev.target.closest('.b3d-card');
      if (card && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); tapCard(card); return; }
      if (card && movable() && (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10'))) { ev.preventDefault(); openMenu(card); return; }
      if (layout === 'carousel' && !ev.target.closest('.b3d-bar') && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
        setFocus(Math.round(focus) + (ev.key === 'ArrowLeft' ? -1 : 1));
      }
    }
    function onWheel(ev) {
      // колесо над переполненным списком листает список; камера зумит только у края прокрутки
      const sc = ev.target.closest && ev.target.closest('[data-board3d-scroll]');
      if (sc && sc.scrollHeight > sc.clientHeight) {
        const atTop = sc.scrollTop <= 0;
        const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1;
        if (ev.deltaY < 0 ? !atTop : !atBottom) return;
      }
      if (ev.target.closest('.b3d-bar,.b3d-dots')) return;
      ev.preventDefault();
      cam.z = clamp(cam.z + ev.deltaY * 2, Z_MIN, Z_MAX);
      applyCamera(false);
    }
    function onContext(ev) { ev.preventDefault(); }
    function onBarClick(ev) {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.layout) setLayout(b.dataset.layout);
      else if (b.hasAttribute('data-reset')) { cam = defaultCamera(); applyCamera(true); }
    }
    function onDotsClick(ev) {
      const b = ev.target.closest('button[data-i]');
      if (b) setFocus(+b.dataset.i);
    }
    function onResize() {
      if (!alive) return;
      const was = mobile;
      mobile = isMobile();
      if (was !== mobile) {
        sizeRoot();
        const want = loadLayout(mobile);
        if (want !== layout) { setLayout(want, { animate: false, save: false }); return; }
        cam = defaultCamera();
        applyCamera(false);
      }
      root.classList.add('instant');
      placeColumns(); syncChrome();
      if (mobile && layout === 'carousel') { cam = defaultCamera(); applyCamera(false); }
      void root.offsetWidth;
      root.classList.remove('instant');
    }

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('click', onClick, true);
    root.addEventListener('keydown', onKey);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('contextmenu', onContext);
    root.addEventListener('animationend', onAnimEnd);
    bar.addEventListener('click', onBarClick);
    dots.addEventListener('click', onDotsClick);
    let ro = null;
    if (global.ResizeObserver) { ro = new ResizeObserver(onResize); ro.observe(root); }
    else global.addEventListener('resize', onResize);

    // ---------- первый кадр ----------
    applyData(data);
    sizeRoot();
    mobile = isMobile();
    if (!(LAYOUTS.indexOf(data.layout) >= 0)) layout = loadLayout(mobile);
    sizeRoot();
    focus = Math.max(0, st.columns.findIndex(c => c[0] === 'new'));   // карусель начинает с «Новых»
    reconcile();
    root.classList.add('instant');
    placeColumns();
    syncChrome();
    cam = defaultCamera();
    applyCamera(false);
    void root.offsetWidth;
    root.classList.remove('instant');
    colEls.forEach(c => { c.isNew = false; });
    stagger();

    return {
      update(d) { if (alive) { applyData(d); refresh(); } },
      setLayout(name) { if (alive) setLayout(name); },
      getLayout() { return layout; },
      reset() { if (alive) { cam = defaultCamera(); applyCamera(true); } },
      destroy() {
        if (!alive) return;
        alive = false;
        closeMenu();
        clearPress();
        if (move) endCardMove(false);
        stopEdge();
        flights.forEach(a => { try { a.cancel(); } catch (_) {} });
        flights.clear();
        timers.forEach(t => clearTimeout(t));
        timers.clear();
        if (ro) ro.disconnect(); else global.removeEventListener('resize', onResize);
        root.removeEventListener('pointerdown', onDown);
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerup', onUp);
        root.removeEventListener('pointercancel', onUp);
        root.removeEventListener('touchmove', onTouchMove);
        root.removeEventListener('click', onClick, true);
        root.removeEventListener('keydown', onKey);
        root.removeEventListener('wheel', onWheel);
        root.removeEventListener('contextmenu', onContext);
        root.removeEventListener('animationend', onAnimEnd);
        bar.removeEventListener('click', onBarClick);
        dots.removeEventListener('click', onDotsClick);
        root.remove();
        fx.remove();
        colEls.clear(); cardEls.clear();
        dropStyle();
        handlers = {};
      }
    };
  }

  global.Board3D = { mount, supported: supports3D, layouts: LAYOUTS.slice(), version: '2.0.0' };
})(window);
