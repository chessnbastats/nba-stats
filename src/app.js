// Buscador que responde preguntas ("puntos de LeBron últimos 3") y comparador contra la línea.
(() => {
  const root = document.body.dataset.root || '';
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
  const nf1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtDay = d => new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'numeric' }).format(new Date(d + 'T12:00:00Z'));

  const LABELS = { pts: 'puntos', reb: 'rebotes', ast: 'asistencias', fg3m: 'triples', stl: 'robos', blk: 'tapones', min: 'minutos', pra: 'PRA', pr: 'puntos + rebotes', pa: 'puntos + asistencias', ra: 'rebotes + asistencias' };
  const SHORT = { pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', stl: 'ROB', blk: 'TAP', min: 'MIN', pra: 'PRA', pr: 'P+R', pa: 'P+A', ra: 'R+A' };
  // Orden importante: primero los combinados.
  const STAT_WORDS = [
    [/\bpra\b|puntos,? rebotes y asistencias|combinad/, 'pra'],
    [/\bp\s?\+\s?r\b|puntos y rebotes/, 'pr'],
    [/\bp\s?\+\s?a\b|puntos y asistencias/, 'pa'],
    [/\br\s?\+\s?a\b|rebotes y asistencias/, 'ra'],
    [/\bpuntos?\b|\bpts\b|\banot\w*/, 'pts'],
    [/\brebotes?\b|\breb\b/, 'reb'],
    [/\basistencias?\b|\bast\b/, 'ast'],
    [/\btriples?\b|\b3pm\b|\btres\b/, 'fg3m'],
    [/\brobos?\b|\bstl\b/, 'stl'],
    [/\btapones?\b|\btapas?\b|\bblk\b|\bbloqueos?\b/, 'blk'],
    [/\bminutos?\b|\bmin\b/, 'min'],
  ];
  const STOP = new Set(['de', 'del', 'en', 'los', 'las', 'el', 'la', 'sus', 'su', 'ultimos', 'ultimo', 'ult', 'partidos', 'partido', 'juegos', 'vs', 'contra', 'y', 'con', 'estadisticas', 'stats', 'promedio', 'promedia', 'promedio', 'cuanto', 'cuantos', 'cuantas', 'hizo', 'hace', 'mete', 'metio', 'tiene', 'que', 'por', 'temporada', 'esta', 'como', 'viene', 'le', 'fue']);

  function parseQuery(q) {
    let s = norm(q);
    let stat = null, n = null, line = null, where = null;
    const l = s.match(/(?:mas de|over|sobre|linea(?: de)?|supera\w*)\s*(\d+(?:[.,]\d)?)/);
    if (l) { line = Number(l[1].replace(',', '.')); s = s.replace(l[0], ' '); }
    for (const [re, key] of STAT_WORDS) if (re.test(s)) { stat = key; s = s.replace(re, ' '); break; }
    const m = s.match(/(?:ultimos?|ult\.?)\s*(\d{1,2})|(\d{1,2})\s*(?:partidos|juegos)/);
    if (m) { n = Number(m[1] || m[2]); s = s.replace(m[0], ' '); }
    if (/\btemporada\b/.test(s)) n = 0;
    if (/\b(local|de local|en casa)\b/.test(s)) { where = 'home'; s = s.replace(/\b(de local|local|en casa)\b/, ' '); }
    else if (/\b(visitante|de visita|afuera)\b/.test(s)) { where = 'away'; s = s.replace(/\b(visitante|de visita|afuera)\b/, ' '); }
    const words = s.replace(/[^a-z0-9ćčđšž' -]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));
    return { stat, n, line, where, words };
  }

  let index = null;
  const loadIndex = () => index ?? (index = fetch(root + 'data/buscador.json').then(r => r.json()).then(list => list.map(p => ({ ...p, k: norm(p.n).split(/[\s.'-]+/) }))));

  function match(list, words) {
    if (!words.length) return [];
    return list.map(p => {
      let score = 0;
      for (const w of words) {
        if (p.k.some(t => t === w)) score += 3;
        else if (p.k.some(t => t.startsWith(w))) score += 2;
        else if (w.length > 2 && p.k.some(t => t.includes(w))) score += 1;
        else return null;
      }
      return { p, score: score + p.p / 100 };
    }).filter(Boolean).sort((a, b) => b.score - a.score).map(x => x.p);
  }

  const value = (e, k) => {
    const v = x => e[x] ?? 0;
    if (k === 'pra') return v('pts') + v('reb') + v('ast');
    if (k === 'pr') return v('pts') + v('reb');
    if (k === 'pa') return v('pts') + v('ast');
    if (k === 'ra') return v('reb') + v('ast');
    return e[k];
  };
  const mean = vals => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);

  // Barras por partido (de más viejo a más nuevo), con la línea punteada si hay una.
  function barsHtml(games, stat, line) {
    const vals = games.map(e => value(e, stat));
    const max = Math.max(line ?? 0, ...vals) * 1.12 || 1;
    return `<div class="bars" style="--cols:${games.length}">${games.map((e, i) => {
      const v = vals[i];
      const cls = line == null ? 'plain' : v > line ? 'over' : v === line ? 'push' : 'under';
      return `<div class="bar ${cls}" title="${fmtDay(e.d)} ${e.h ? 'vs' : '@'} ${esc(e.opp)}: ${v}"><span class="val">${v}</span><span class="fill" style="height:${(v / max) * 100}%"></span><span class="lbl">${e.h ? '' : '@'}${esc(e.opp)}<br>${fmtDay(e.d)}</span></div>`;
    }).join('')}${line == null ? '' : `<div class="plot"><div class="line" style="bottom:${(line / max) * 100}%"><span>${nf.format(line)}</span></div></div>`}</div>`;
  }

  // ---------- Respuesta directa ----------
  async function answer(box, q) {
    const parsed = parseQuery(q);
    const found = match(await loadIndex(), parsed.words);
    box.hidden = false;
    if (!parsed.words.length || !found.length) {
      box.innerHTML = `<p class="muted">No encontré a ningún jugador en "${esc(q)}". Probá con el apellido, por ejemplo <em>puntos de Curry últimos 5</em>.</p>`;
      return;
    }
    const p = found[0];
    box.innerHTML = '<p class="muted">Buscando…</p>';
    const data = await fetch(`${root}data/jugadores/${p.s}.json`).then(r => r.json());
    let log = data.log;
    if (parsed.where) log = log.filter(e => (parsed.where === 'home' ? e.h : !e.h));
    const n = parsed.n === 0 ? log.length : Math.min(parsed.n || 10, log.length);
    const games = log.slice(0, n);
    const where = parsed.where === 'home' ? ' de local' : parsed.where === 'away' ? ' de visitante' : '';
    const span = parsed.n === 0 ? `en la temporada${where} (${n} partidos)` : n === 1 ? `en su último partido${where}` : `en sus últimos ${n} partidos${where}`;
    const href = `${root}jugador/${p.s}.html`;
    const others = found.slice(1, 4);

    let html;
    if (!games.length) {
      html = `<p><strong>${esc(data.name)}</strong> no tiene partidos${where} todavía.</p>`;
    } else if (parsed.stat) {
      const stat = parsed.stat;
      const vals = games.map(e => value(e, stat));
      const avg = mean(vals);
      const verb = n === 1 ? 'hizo' : 'promedió';
      const num = n === 1 ? nf.format(avg) : nf1.format(avg);
      let lineText = '';
      if (parsed.line != null) {
        const over = vals.filter(v => v > parsed.line).length;
        const pct = Math.round((over / vals.length) * 100);
        lineText = `<p class="ans-line ${pct >= 60 ? 'good' : pct <= 40 ? 'bad' : ''}">Superó <strong>${nf.format(parsed.line)}</strong> en <strong>${over} de ${vals.length}</strong> (${pct}%)</p>`;
      }
      html = `
        <p class="ans-text"><a href="${href}"><strong>${esc(data.name)}</strong></a> ${verb} <strong>${num} ${LABELS[stat]}</strong> ${span}.</p>
        <div class="ans-big"><span class="big">${num}</span><span class="unit">${SHORT[stat]}${n > 1 ? ' por partido' : ''}</span></div>
        ${lineText}
        <p class="muted small">Máximo ${nf.format(Math.max(...vals))} · Mínimo ${nf.format(Math.min(...vals))} · ${esc(data.teamName || data.team || '')}</p>
        <div class="chart">${barsHtml(games.slice().reverse(), stat, parsed.line)}</div>
        <a class="ans-more" href="${href}?stat=${stat}&n=${parsed.n === 0 ? 0 : n}${parsed.line != null ? `&line=${parsed.line}` : ''}#comparador">Compararlo contra una línea →</a>`;
    } else {
      const cell = k => `<div><span class="big">${nf1.format(mean(games.map(e => value(e, k))))}</span><span class="unit">${SHORT[k]}</span></div>`;
      html = `
        <p class="ans-text"><a href="${href}"><strong>${esc(data.name)}</strong></a> ${span}:</p>
        <div class="bignums">${['pts', 'reb', 'ast', 'pra'].map(cell).join('')}</div>
        <p class="muted small">Promedios por partido · ${esc(data.teamName || data.team || '')}</p>
        <a class="ans-more" href="${href}">Ver la ficha completa →</a>`;
    }
    if (others.length) html += `<p class="ans-others muted small">¿Buscabas a ${others.map(o => `<a href="#" data-name="${esc(o.n)}">${esc(o.n)}</a>`).join(', ')}?</p>`;
    box.innerHTML = html;
    for (const a of box.querySelectorAll('[data-name]')) {
      a.addEventListener('click', e => {
        e.preventDefault();
        const rest = norm(q).split(/\s+/).filter(w => !parsed.words.includes(w)).join(' ');
        const nq = `${rest} ${a.dataset.name}`.trim();
        box.previousElementSibling.querySelector('input').value = nq;
        answer(box, nq);
      });
    }
  }

  const playerHref = (p, parsed) => {
    const params = new URLSearchParams();
    if (parsed.stat) params.set('stat', parsed.stat);
    if (parsed.n != null) params.set('n', parsed.n);
    const qs = params.toString();
    return `${root}jugador/${p.s}.html${qs ? `?${qs}#comparador` : ''}`;
  };

  for (const form of document.querySelectorAll('form.search')) {
    const input = form.querySelector('input');
    const list = form.querySelector('.suggest');
    const box = form.nextElementSibling?.classList.contains('answer') ? form.nextElementSibling : null;
    let results = [], parsed = null, active = -1;

    const render = () => {
      if (!results.length) { list.hidden = true; list.innerHTML = ''; return; }
      const what = parsed.stat ? ` · ${LABELS[parsed.stat]}${parsed.n ? ` últ. ${parsed.n}` : ''}` : '';
      list.innerHTML = results.slice(0, 6).map((p, i) => `<li role="option"${i === active ? ' aria-selected="true"' : ''}><a href="${playerHref(p, parsed)}"><strong>${esc(p.n)}</strong><span>${esc(p.t)}${what}</span></a></li>`).join('');
      list.hidden = false;
    };

    input.addEventListener('focus', loadIndex, { once: true });
    input.addEventListener('input', async () => {
      parsed = parseQuery(input.value);
      results = match(await loadIndex(), parsed.words);
      active = -1;
      if (document.activeElement === input) render(); // si ya se envió, no tapar la respuesta
    });
    input.addEventListener('keydown', e => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const max = Math.min(results.length, 6);
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + max) % max; render();
      } else if (e.key === 'Escape') { list.hidden = true; }
    });
    document.addEventListener('click', e => { if (!form.contains(e.target)) list.hidden = true; });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      list.hidden = true;
      // Elegido con las flechas: ir a la ficha. Si no, responder acá mismo.
      if (active >= 0 && results[active]) { location.href = playerHref(results[active], parsed); return; }
      if (!box) return;
      input.blur();
      await answer(box, input.value);
      const u = new URL(location.href);
      u.searchParams.set('q', input.value);
      history.replaceState(null, '', u);
    });

    // Una pregunta compartida por link (?q=...) se responde al abrir la página.
    const shared = new URLSearchParams(location.search).get('q');
    if (box && shared && form.classList.contains('hero-search')) { input.value = shared; answer(box, shared); }
  }

  for (const chip of document.querySelectorAll('.chip[data-q]')) {
    chip.addEventListener('click', () => {
      const form = document.querySelector('form.search.hero-search');
      form.querySelector('input').value = chip.dataset.q;
      form.requestSubmit();
    });
  }

  // Página de jugadores: filtra por lo que se buscó sin resultado exacto.
  const msg = document.getElementById('search-result-msg');
  const q = new URLSearchParams(location.search).get('q');
  if (msg && q) {
    const words = parseQuery(q).words;
    let shown = 0;
    for (const li of document.querySelectorAll('.teams-list li[data-name]')) {
      const k = norm(li.dataset.name);
      const ok = words.length && words.every(w => k.includes(w));
      li.hidden = !ok; if (ok) shown++;
    }
    for (const card of document.querySelectorAll('.teams-list .card')) card.hidden = !card.querySelector('li:not([hidden])');
    msg.textContent = shown ? `Resultados para "${q}"` : `No encontramos "${q}". Probá con el apellido.`;
    if (!shown) for (const el of document.querySelectorAll('.teams-list [hidden]')) el.hidden = false;
  }

  // ---------- Comparador ----------
  const dataEl = document.getElementById('player-data');
  const cmp = document.querySelector('.cmp');
  if (!dataEl || !cmp) return;
  const data = JSON.parse(dataEl.textContent);
  const params = new URLSearchParams(location.search);
  const nParam = Number(params.get('n'));
  const state = {
    stat: LABELS[params.get('stat')] ? params.get('stat') : 'pts',
    n: params.has('n') && Number.isInteger(nParam) && nParam >= 0 && nParam <= 82 ? nParam : 10,
    f: 'all',
    line: params.get('line') ? Number(params.get('line').replace(',', '.')) : null,
  };
  const sel = cmp.querySelector('select[name=stat]');
  const lineIn = cmp.querySelector('input[name=line]');
  const summary = cmp.querySelector('.cmp-summary');
  const chart = cmp.querySelector('.chart');
  const hit = cmp.querySelector('.hitrates');

  const filtered = () => data.log.filter(e => state.f === 'all' || (state.f === 'home' ? e.h : state.f === 'away' ? !e.h : e.opp === data.todayOpp));
  const suggestedLine = () => {
    const vals = data.log.slice(0, 10).map(e => value(e, state.stat)).filter(v => v != null);
    return vals.length ? Math.floor(mean(vals)) + 0.5 : 0.5;
  };

  function draw() {
    if (state.line == null || Number.isNaN(state.line)) state.line = suggestedLine();
    sel.value = state.stat;
    if (document.activeElement !== lineIn) lineIn.value = nf.format(state.line);
    for (const b of cmp.querySelectorAll('[data-n]')) b.setAttribute('aria-pressed', Number(b.dataset.n) === state.n);
    for (const b of cmp.querySelectorAll('[data-f]')) b.setAttribute('aria-pressed', b.dataset.f === state.f);

    const all = filtered().filter(e => value(e, state.stat) != null);
    const games = (state.n ? all.slice(0, state.n) : all).slice().reverse();
    const vals = games.map(e => value(e, state.stat));
    const over = vals.filter(v => v > state.line).length;
    const push = vals.filter(v => v === state.line).length;
    const under = vals.length - over - push;
    const avg = mean(vals);
    const sorted = [...vals].sort((a, b) => a - b);
    const med = vals.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
    const pct = vals.length ? Math.round((over / vals.length) * 100) : 0;
    const tone = pct >= 60 ? 'good' : pct <= 40 ? 'bad' : 'mid';
    const label = LABELS[state.stat];

    if (!vals.length) {
      summary.innerHTML = '<p class="muted">No hay partidos para este filtro.</p>';
      chart.innerHTML = ''; hit.innerHTML = ''; return;
    }
    summary.innerHTML = `
      <div class="hit ${tone}"><span class="big">${over}<small>/${vals.length}</small></span><span class="pct">${pct}%</span></div>
      <p>Superó <strong>${nf.format(state.line)} ${label}</strong> en <strong>${over} de ${vals.length}</strong> partidos${push ? ` (${push} igual)` : ''}. Quedó por debajo en ${under}.</p>
      <p class="muted">Promedio <strong>${nf.format(avg)}</strong> · Mediana <strong>${nf.format(med)}</strong></p>`;

    chart.setAttribute('aria-label', `Gráfico: ${over} de ${vals.length} partidos por encima de ${nf.format(state.line)} ${label}`);
    chart.innerHTML = barsHtml(games, state.stat, state.line);

    hit.innerHTML = [5, 10, 20].map(n => {
      const g = all.slice(0, n);
      if (g.length < n && n !== 5) return '';
      const o = g.filter(e => value(e, state.stat) > state.line).length;
      return `<span>Últ. ${n}: <strong>${o}/${g.length}</strong></span>`;
    }).join('');

    const u = new URL(location.href);
    u.searchParams.set('stat', state.stat); u.searchParams.set('n', state.n); u.searchParams.set('line', state.line);
    history.replaceState(null, '', u);
  }

  sel.addEventListener('change', () => { state.stat = sel.value; state.line = null; draw(); });
  lineIn.addEventListener('input', () => {
    const v = Number(lineIn.value.replace(',', '.'));
    if (lineIn.value.trim() !== '' && Number.isFinite(v)) { state.line = v; draw(); }
  });
  lineIn.addEventListener('blur', draw);
  cmp.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.n) state.n = Number(b.dataset.n);
    if (b.dataset.f) state.f = b.dataset.f;
    draw();
  });
  draw();
})();
