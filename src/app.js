// Buscador (entiende frases como "puntos de Curry últimos 5") y comparador contra la línea.
(() => {
  const root = document.body.dataset.root || '';
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const LABELS = { pts: 'puntos', reb: 'rebotes', ast: 'asistencias', fg3m: 'triples', stl: 'robos', blk: 'tapones', min: 'minutos', pra: 'PRA', pr: 'puntos + rebotes', pa: 'puntos + asistencias', ra: 'rebotes + asistencias' };
  // Orden importante: primero los combinados.
  const STAT_WORDS = [
    [/\bpra\b|puntos,? rebotes y asistencias|combinad/, 'pra'],
    [/\bp\s?\+\s?r\b|puntos y rebotes/, 'pr'],
    [/\bp\s?\+\s?a\b|puntos y asistencias/, 'pa'],
    [/\br\s?\+\s?a\b|rebotes y asistencias/, 'ra'],
    [/\bpuntos?\b|\bpts\b|\banot/, 'pts'],
    [/\brebotes?\b|\breb\b/, 'reb'],
    [/\basistencias?\b|\bast\b/, 'ast'],
    [/\btriples?\b|\b3pm\b|\btres\b/, 'fg3m'],
    [/\brobos?\b|\bstl\b/, 'stl'],
    [/\btapones?\b|\btapas?\b|\bblk\b|\bbloqueos?\b/, 'blk'],
    [/\bminutos?\b|\bmin\b/, 'min'],
  ];
  const STOP = new Set(['de', 'del', 'en', 'los', 'las', 'el', 'la', 'ultimos', 'ultimo', 'ult', 'partidos', 'partido', 'juegos', 'vs', 'contra', 'y', 'con', 'estadisticas', 'stats', 'promedio', 'cuantos', 'cuantas', 'hizo', 'mete', 'tiene']);

  function parseQuery(q) {
    let s = norm(q);
    let stat = null, n = null;
    for (const [re, key] of STAT_WORDS) if (re.test(s)) { stat = key; s = s.replace(re, ' '); break; }
    const m = s.match(/(?:ultimos?|ult\.?)\s*(\d{1,2})|(\d{1,2})\s*(?:partidos|juegos)/);
    if (m) { n = Number(m[1] || m[2]); s = s.replace(m[0], ' '); }
    const words = s.replace(/[^a-z0-9ćčđšž' -]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));
    return { stat, n, words };
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
        else if (p.k.some(t => t.includes(w))) score += 1;
        else return null;
      }
      return { p, score: score + p.p / 100 };
    }).filter(Boolean).sort((a, b) => b.score - a.score).map(x => x.p);
  }

  const playerHref = (p, parsed) => {
    const params = new URLSearchParams();
    if (parsed.stat) params.set('stat', parsed.stat);
    if (parsed.n) params.set('n', parsed.n);
    const qs = params.toString();
    return `${root}jugador/${p.s}.html${qs ? `?${qs}#comparador` : ''}`;
  };

  for (const form of document.querySelectorAll('form.search')) {
    const input = form.querySelector('input');
    const list = form.querySelector('.suggest');
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
      active = -1; render();
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
      parsed = parseQuery(input.value);
      results = match(await loadIndex(), parsed.words);
      const p = results[Math.max(active, 0)];
      if (p) location.href = playerHref(p, parsed);
      else location.href = `${root}jugadores.html?q=${encodeURIComponent(input.value)}`;
    });
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
  const value = (e, k) => {
    const v = x => e[x] ?? 0;
    if (k === 'pra') return v('pts') + v('reb') + v('ast');
    if (k === 'pr') return v('pts') + v('reb');
    if (k === 'pa') return v('pts') + v('ast');
    if (k === 'ra') return v('reb') + v('ast');
    return e[k];
  };
  const params = new URLSearchParams(location.search);
  const state = {
    stat: LABELS[params.get('stat')] ? params.get('stat') : 'pts',
    n: [0, 5, 10, 20].includes(Number(params.get('n'))) ? Number(params.get('n')) : 10,
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
    if (!vals.length) return 0.5;
    return Math.floor(vals.reduce((a, b) => a + b, 0) / vals.length) + 0.5;
  };
  const fmtDay = d => new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'numeric' }).format(new Date(d + 'T12:00:00Z'));

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
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
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

    const max = Math.max(state.line, ...vals) * 1.12 || 1;
    const linePct = (state.line / max) * 100;
    chart.setAttribute('aria-label', `Gráfico: ${over} de ${vals.length} partidos por encima de ${nf.format(state.line)} ${label}`);
    chart.style.setProperty('--cols', games.length);
    chart.innerHTML = `<div class="bars">${games.map((e, i) => {
      const v = vals[i];
      const cls = v > state.line ? 'over' : v === state.line ? 'push' : 'under';
      return `<div class="bar ${cls}" title="${fmtDay(e.d)} ${e.h ? 'vs' : '@'} ${e.opp}: ${v}"><span class="val">${v}</span><span class="fill" style="height:${(v / max) * 100}%"></span><span class="lbl">${e.h ? '' : '@'}${esc(e.opp)}<br>${fmtDay(e.d)}</span></div>`;
    }).join('')}<div class="plot"><div class="line" style="bottom:${linePct}%"><span>${nf.format(state.line)}</span></div></div></div>`;

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
