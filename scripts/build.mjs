// Genera el sitio estático en dist/: inicio, jugadores, equipos, defensa, sitemap y robots.
// Uso: node scripts/build.mjs          (datos reales de data/games; si no hay, usa DEMO)
//      node scripts/build.mjs --demo   (datos de ejemplo de data/demo/games)
import { mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import config from '../site.config.mjs';
import { ymd, slugify, readJson, listGameFiles } from './lib.mjs';

const OUT = 'dist';
let demo = process.argv.includes('--demo') || process.env.DEMO === '1';
let dir = demo ? 'data/demo/games' : 'data/games';
let files = await listGameFiles(dir);
let days = (await Promise.all(files.map(f => readJson(`${dir}/${f}`)))).filter(Boolean);
// Sin estadísticas de jugadores el sitio queda vacío: hasta que lleguen, se muestra el DEMO.
if (!demo && !days.some(d => d.games.some(g => g.players?.length))) {
  console.warn('Todavía no hay box scores reales: armo el sitio con los datos DEMO.');
  demo = true; dir = 'data/demo/games'; files = await listGameFiles(dir);
  days = (await Promise.all(files.map(f => readJson(`${dir}/${f}`)))).filter(Boolean);
}
if (!files.length) { console.error('No hay datos. Corré primero: npm run demo'); process.exit(1); }

// ---------- Armado de datos ----------
const STATS = { min: 'MIN', pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', stl: 'ROB', blk: 'TAP', pra: 'PRA' };
const teams = new Map();
const players = new Map();
const played = p => (p.min ?? 0) > 0 || (p.pts ?? 0) > 0;

for (const day of days) {
  for (const g of day.games) {
    for (const t of [g.home, g.away]) {
      const prev = teams.get(t.id);
      teams.set(t.id, { games: [], ...prev, id: t.id, name: t.name, short: t.short, abbr: t.abbr, logo: t.logo || prev?.logo || null, slug: slugify(t.abbr || t.name) });
    }
    if (g.status !== 'final' || !g.players?.length) continue;
    for (const [side, other] of [[g.home, g.away], [g.away, g.home]]) {
      const opp = g.players.filter(p => p.teamId === other.id && played(p));
      const sum = k => opp.reduce((s, p) => s + (p[k] ?? 0), 0);
      teams.get(side.id).games.push({
        d: g.date, h: side === g.home, opp: other.id, pf: side.score, pa: other.score,
        oreb: sum('reb'), oast: sum('ast'), o3: sum('fg3m'),
      });
    }
    for (const p of g.players) {
      if (!played(p)) continue;
      const home = p.teamId === g.home.id;
      const mine = home ? g.home : g.away, other = home ? g.away : g.home;
      const entry = players.get(p.id) ?? { id: p.id, name: p.name, log: [] };
      entry.name = p.name; entry.teamId = p.teamId; entry.jersey = p.jersey ?? entry.jersey;
      entry.log.push({
        d: g.date, opp: other.abbr, oppId: other.id, h: home ? 1 : 0, w: mine.score > other.score ? 1 : 0, sc: `${mine.score}-${other.score}`,
        min: p.min, pts: p.pts, reb: p.reb, ast: p.ast, fg3m: p.fg3m, stl: p.stl, blk: p.blk,
        pra: (p.pts ?? 0) + (p.reb ?? 0) + (p.ast ?? 0),
      });
      players.set(p.id, entry);
    }
  }
}

// Slugs únicos para las URLs de jugadores.
const usedSlugs = new Set();
for (const p of players.values()) {
  p.log.sort((a, b) => b.d.localeCompare(a.d));
  let s = slugify(p.name);
  if (usedSlugs.has(s)) s = `${s}-${p.id}`;
  usedSlugs.add(s); p.slug = s;
  p.team = teams.get(p.teamId);
}

const avg = (log, k, n = log.length) => {
  const v = log.slice(0, n).map(e => e[k]).filter(x => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// Defensa: lo que permite cada equipo por partido, con ranking (1 = el que menos permite).
for (const t of teams.values()) {
  const n = t.games.length;
  t.gp = n;
  t.wins = t.games.filter(g => g.pf > g.pa).length;
  t.ppg = n ? t.games.reduce((s, g) => s + g.pf, 0) / n : null;
  t.def = n ? {
    pts: t.games.reduce((s, g) => s + g.pa, 0) / n,
    reb: t.games.reduce((s, g) => s + g.oreb, 0) / n,
    ast: t.games.reduce((s, g) => s + g.oast, 0) / n,
    fg3m: t.games.reduce((s, g) => s + g.o3, 0) / n,
  } : null;
}
const ranked = [...teams.values()].filter(t => t.def);
for (const k of ['pts', 'reb', 'ast', 'fg3m']) {
  [...ranked].sort((a, b) => a.def[k] - b.def[k]).forEach((t, i) => { t.def[k + 'Rank'] = i + 1; });
}

// Partidos de hoy (fecha NBA). En DEMO, si el día quedó viejo, uso el último programado.
const todayKey = ymd();
let todayDay = days.find(d => d.date === todayKey);
if (!todayDay && demo) todayDay = [...days].reverse().find(d => d.games.some(g => g.status !== 'final'));
const todayGames = (todayDay?.games ?? []).sort((a, b) => a.start.localeCompare(b.start));
const todayOpp = new Map();
for (const g of todayGames) { todayOpp.set(g.home.id, { opp: g.away, home: true, g }); todayOpp.set(g.away.id, { opp: g.home, home: false, g }); }
const lastDay = [...days].reverse().find(d => d.games.some(g => g.status === 'final' && g.players?.length));

const roster = teamId => [...players.values()].filter(p => p.teamId === teamId).sort((a, b) => (avg(b.log, 'pts', 10) ?? 0) - (avg(a.log, 'pts', 10) ?? 0));

// ---------- Helpers de HTML ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt = v => (v == null ? '–' : nf1.format(v));
const fmtInt = v => (v == null ? '–' : String(v));
const fmtDay = d => new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00Z')).replace('.', '');
const fmtLongDay = d => new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d + 'T12:00:00Z'));
const fmtTime = iso => new Intl.DateTimeFormat('es-AR', { timeZone: config.displayTimeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) + ' hs';
const teamUrl = (t, root) => `${root}equipo/${t.slug}.html`;
const playerUrl = (p, root) => `${root}jugador/${p.slug}.html`;
const badge = (t, size = 'md') => t.logo
  ? `<img class="logo ${size}" src="${esc(t.logo)}" alt="" loading="lazy" width="40" height="40">`
  : `<span class="logo ${size} mono" aria-hidden="true">${esc(t.abbr)}</span>`;

const ad = label => config.adsenseClient
  ? `<div class="ad"><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(config.adsenseClient)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>`
  : `<div class="ad placeholder" aria-hidden="true">Espacio publicitario · ${esc(label)}</div>`;
const affiliates = () => config.affiliates.length
  ? `<aside class="affiliates">${config.affiliates.map(a => `<a class="aff" href="${esc(a.url)}" rel="sponsored noopener" target="_blank">${esc(a.text || a.name)}</a>`).join('')}<p class="fine">Link de afiliado. +18 · Jugá responsablemente.</p></aside>`
  : `<aside class="affiliates placeholder" aria-hidden="true">Espacio para casas de apuestas con licencia</aside>`;

const searchForm = (root, big = false) => `
<form class="search${big ? ' hero-search' : ''}" role="search" action="${root}jugadores.html" autocomplete="off">
  <svg class="search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
  <input name="q" type="search" placeholder="${big ? 'puntos de Jokić últ. 10' : 'Buscar jugador o estadística'}" aria-label="Buscar jugador o estadística" enterkeyhint="search">
  <button type="submit">Buscar</button>
  <ul class="suggest" role="listbox" hidden></ul>
</form>
<div class="answer card" aria-live="polite" hidden></div>`;

const pages = [];
function page({ path, title, desc, body, home = false }) {
  const root = '../'.repeat(path.split('/').length - 1);
  const canonical = `${config.url}/${path === 'index.html' ? '' : path}`;
  pages.push(path);
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="es_AR">
<meta name="theme-color" content="#0f172a">
${demo ? '<meta name="robots" content="noindex">' : ''}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%232f5bea'/%3E%3Cpath d='M6 22h20' stroke='%23ffb020' stroke-width='3'/%3E%3Cpath d='M9 18v-6M16 18V8M23 18v-9' stroke='white' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="${root}assets/style.css">
${config.adsenseClient ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(config.adsenseClient)}" crossorigin="anonymous"></script>` : ''}
</head>
<body data-root="${root}">
${demo ? '<div class="demo-bar">DEMO · Datos de ejemplo con jugadores inventados</div>' : ''}
<header class="top">
  <a class="brand" href="${root}index.html" aria-label="${esc(config.name)}, inicio"><span class="brand-mark" aria-hidden="true"></span>${esc(config.name)}</a>
  <nav><a href="${root}index.html#hoy">Hoy</a><a href="${root}jugadores.html">Jugadores</a><a href="${root}defensa.html">Defensa</a></nav>
</header>
${home ? '' : `<div class="top-search">${searchForm(root)}</div>`}
<main>
${body}
</main>
<footer class="foot">
  <p class="resp"><strong>+18</strong> · Jugá responsablemente. Las estadísticas no garantizan resultados.</p>
  <p>${esc(config.name)} · ${esc(config.tagline)} · Datos actualizados ${esc(fmtLongDay(lastDay?.date ?? todayKey))}.</p>
  <p>Sin relación con la NBA ni con sus equipos.</p>
</footer>
<script src="${root}assets/app.js" defer></script>
</body>
</html>
`;
  return write(path, html);
}

async function write(path, content) {
  await mkdir(dirname(`${OUT}/${path}`), { recursive: true });
  await writeFile(`${OUT}/${path}`, content);
}

const statTable = (rows, cols = Object.keys(STATS)) => `
<div class="table-wrap"><table class="stats">
<thead><tr><th scope="col"></th>${cols.map(k => `<th scope="col">${STATS[k]}</th>`).join('')}</tr></thead>
<tbody>${rows.map(([label, log, n]) => `<tr><th scope="row">${esc(label)}${n ? ` <span class="muted">(${Math.min(n, log.length)})</span>` : ` <span class="muted">(${log.length})</span>`}</th>${cols.map(k => `<td${k === 'pra' ? ' class="hl"' : ''}>${fmt(avg(log, k, n))}</td>`).join('')}</tr>`).join('')}</tbody>
</table></div>`;

const gameLog = (log, root) => `
<div class="table-wrap"><table class="stats log">
<thead><tr><th scope="col">Fecha</th><th scope="col">Rival</th><th scope="col">Res.</th>${Object.keys(STATS).map(k => `<th scope="col">${STATS[k]}</th>`).join('')}</tr></thead>
<tbody>${log.map(e => {
  const t = teams.get(e.oppId);
  return `<tr><td>${fmtDay(e.d)}</td><td class="opp">${e.h ? 'vs' : '@'} <a href="${teamUrl(t, root)}">${esc(e.opp)}</a></td><td class="${e.w ? 'win' : 'loss'}">${e.w ? 'G' : 'P'} ${esc(e.sc)}</td>${Object.keys(STATS).map(k => `<td${k === 'pra' ? ' class="hl"' : ''}>${k === 'min' ? fmt(e.min) : fmtInt(e[k])}</td>`).join('')}</tr>`;
}).join('')}</tbody>
</table></div>`;

// ---------- Páginas ----------
await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/assets`, { recursive: true });
await cp('src', `${OUT}/assets`, { recursive: true });
await writeFile(`${OUT}/.nojekyll`, '');

const topScorers = [...players.values()].filter(p => p.log.length >= 3)
  .sort((a, b) => avg(b.log, 'pts', 10) - avg(a.log, 'pts', 10));
const examples = topScorers.slice(0, 3);
const exampleQueries = [
  examples[0] && `puntos de ${examples[0].name.split(' ').pop()} últimos 3`,
  examples[1] && `rebotes de ${examples[1].name.split(' ').pop()} más de 9,5`,
  examples[2] && `${examples[2].name.split(' ').pop()} últimos 5`,
].filter(Boolean);

// Buscador: índice liviano que baja el navegador.
await write('data/buscador.json', JSON.stringify([...players.values()]
  .sort((a, b) => (avg(b.log, 'min', 10) ?? 0) - (avg(a.log, 'min', 10) ?? 0))
  .map(p => ({ n: p.name, s: p.slug, t: p.team?.abbr ?? '', p: Math.round((avg(p.log, 'pts', 10) ?? 0) * 10) / 10 }))));

// Inicio
{
  const gameCard = g => {
    const side = t => {
      const team = teams.get(t.id);
      const r = roster(t.id).slice(0, 8);
      return `<div class="roster"><h4><a href="${teamUrl(team, '')}">${esc(team.name)}</a></h4><ul>${r.map(p => `<li><a href="${playerUrl(p, '')}">${esc(p.name)}</a><span>${fmt(avg(p.log, 'pts', 10))} pts</span></li>`).join('') || '<li class="muted">Sin datos todavía</li>'}</ul></div>`;
    };
    const rec = t => { const x = teams.get(t.id); return x.gp ? `${x.wins}-${x.gp - x.wins}` : ''; };
    return `<article class="game card">
  <div class="matchup">
    <a class="team" href="${teamUrl(teams.get(g.away.id), '')}">${badge(g.away)}<span class="abbr">${esc(g.away.abbr)}</span><span class="rec">${rec(g.away)}</span></a>
    <div class="vs">${g.status === 'final' ? `<strong>${g.away.score} – ${g.home.score}</strong><small>Final</small>` : `<strong>${fmtTime(g.start)}</strong><small>${g.status === 'live' ? 'En juego' : '@'}</small>`}</div>
    <a class="team" href="${teamUrl(teams.get(g.home.id), '')}">${badge(g.home)}<span class="abbr">${esc(g.home.abbr)}</span><span class="rec">${rec(g.home)}</span></a>
  </div>
  <details><summary>Ver jugadores</summary><div class="rosters">${side(g.away)}${side(g.home)}</div></details>
</article>`;
  };

  const lastFinals = (lastDay?.games ?? []).filter(g => g.status === 'final');
  const best = lastFinals.flatMap(g => g.players.filter(played).map(p => ({ p, g })))
    .sort((a, b) => (b.p.pts ?? 0) - (a.p.pts ?? 0)).slice(0, 6);

  await page({
    path: 'index.html', home: true,
    title: `${config.name}: estadísticas NBA para apostar, en español`,
    desc: 'Estadísticas NBA en español para apostadores: últimos 5, 10 y 20 partidos de cada jugador, comparador contra la línea, defensa de cada equipo y partidos de hoy.',
    body: `
<section class="hero">
  <h1>Estadísticas NBA para apostar</h1>
  <p class="lead">Buscá un jugador, cargá la línea y mirá cuántas veces la superó.</p>
  ${searchForm('', true)}
  <div class="chips">${exampleQueries.map(q => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
</section>

<section id="hoy" class="block">
  <div class="block-head"><h2>Partidos de hoy</h2><span class="muted">${todayDay ? esc(fmtLongDay(todayDay.date)) : ''} · horario de Argentina</span></div>
  ${todayGames.length ? `<div class="games">${todayGames.map(gameCard).join('')}</div>` : '<p class="empty card">Hoy no hay partidos de NBA.</p>'}
</section>

${ad('inicio')}

${best.length ? `<section class="block">
  <div class="block-head"><h2>Figuras de la última fecha</h2><span class="muted">${esc(fmtLongDay(lastDay.date))}</span></div>
  <div class="leaders">${best.map(({ p, g }) => {
    const pl = players.get(p.id); const opp = p.teamId === g.home.id ? g.away : g.home;
    return `<a class="leader card" href="${playerUrl(pl, '')}"><span class="big">${p.pts}</span><span class="unit">PTS</span><span class="who"><strong>${esc(p.name)}</strong><small>${esc(pl.team?.abbr)} vs ${esc(opp.abbr)} · ${p.reb ?? 0} REB · ${p.ast ?? 0} AST</small></span></a>`;
  }).join('')}</div>
</section>` : ''}

<section class="block">
  <div class="block-head"><h2>Máximos anotadores</h2><span class="muted">promedio últimos 10</span></div>
  <ol class="rank card">${topScorers.slice(0, 10).map(p => `<li><a href="${playerUrl(p, '')}"><span class="name">${esc(p.name)}</span><span class="muted">${esc(p.team?.abbr)}</span><span class="val">${fmt(avg(p.log, 'pts', 10))}</span></a></li>`).join('')}</ol>
</section>

<section class="block">
  <a class="cta card" href="defensa.html"><strong>Defensa de cada equipo</strong><span>Qué rivales permiten más puntos, rebotes, asistencias y triples →</span></a>
</section>

${affiliates()}`,
  });
}

// Jugadores
for (const p of players.values()) {
  const path = `jugador/${p.slug}.html`;
  const root = '../';
  const t = p.team;
  const today = t && todayOpp.get(t.id);
  const vsLog = today ? p.log.filter(e => e.oppId === today.opp.id) : [];
  const oppTeam = today && teams.get(today.opp.id);
  const l10 = k => fmt(avg(p.log, k, 10));
  const dataForJs = {
    name: p.name, team: t?.abbr, todayOpp: today ? today.opp.abbr : null,
    log: p.log.map(({ d, opp, h, w, min, pts, reb, ast, fg3m, stl, blk }) => ({ d, opp, h, w, min, pts, reb, ast, fg3m, stl, blk })),
  };
  // El buscador baja este archivo para responder preguntas sin salir de la página.
  await write(`data/jugadores/${p.slug}.json`, JSON.stringify({ ...dataForJs, slug: p.slug, teamName: t?.name ?? '' }));

  await page({
    path,
    title: `Estadísticas de ${p.name}: últimos 10 partidos | ${config.name}`,
    desc: `${p.name} (${t?.name ?? ''}) en sus últimos 10 partidos: ${l10('pts')} puntos, ${l10('reb')} rebotes y ${l10('ast')} asistencias por partido. Compará contra la línea de apuestas.`,
    body: `
<section class="player-hero card">
  <div class="ph-top">
    ${t ? badge(t, 'lg') : ''}
    <div>
      <h1>${esc(p.name)}${demo ? ' <span class="tag">DEMO</span>' : ''}</h1>
      <p class="muted">${t ? `<a href="${teamUrl(t, root)}">${esc(t.name)}</a>` : ''}${p.jersey ? ` · #${esc(p.jersey)}` : ''} · ${p.log.length} partidos esta temporada</p>
    </div>
  </div>
  <div class="bignums">
    ${['pts', 'reb', 'ast', 'pra'].map(k => `<div><span class="big">${l10(k)}</span><span class="unit">${STATS[k]}</span></div>`).join('')}
  </div>
  <p class="muted small">Promedio de los últimos ${Math.min(10, p.log.length)} partidos</p>
  ${today ? `<p class="today-pill">Hoy ${today.home ? 'vs' : '@'} <a href="${teamUrl(oppTeam, root)}">${esc(oppTeam.name)}</a> · ${fmtTime(today.g.start)}${oppTeam.def ? ` · defensa #${oppTeam.def.ptsRank} (permite ${fmt(oppTeam.def.pts)} pts)` : ''}</p>` : ''}
</section>

<section class="block" id="comparador">
  <h2>Comparador contra la línea</h2>
  <div class="card cmp">
    <div class="cmp-controls">
      <label>Estadística
        <select name="stat">
          <option value="pts">Puntos</option><option value="reb">Rebotes</option><option value="ast">Asistencias</option>
          <option value="fg3m">Triples</option><option value="pra">Pts + Reb + Ast</option><option value="pr">Pts + Reb</option>
          <option value="pa">Pts + Ast</option><option value="ra">Reb + Ast</option><option value="stl">Robos</option>
          <option value="blk">Tapones</option><option value="min">Minutos</option>
        </select>
      </label>
      <label>Línea
        <input name="line" type="text" inputmode="decimal" placeholder="24,5">
      </label>
    </div>
    <div class="seg" role="group" aria-label="Cantidad de partidos">
      <button type="button" data-n="5">Últ. 5</button><button type="button" data-n="10">Últ. 10</button><button type="button" data-n="20">Últ. 20</button><button type="button" data-n="0">Temporada</button>
    </div>
    <div class="seg" role="group" aria-label="Filtro">
      <button type="button" data-f="all">Todos</button><button type="button" data-f="home">Local</button><button type="button" data-f="away">Visitante</button>${today ? `<button type="button" data-f="opp">vs ${esc(today.opp.abbr)}</button>` : ''}
    </div>
    <div class="cmp-summary" aria-live="polite"></div>
    <div class="chart" role="img"></div>
    <div class="hitrates"></div>
    <noscript><p class="muted">Activá JavaScript para usar el comparador.</p></noscript>
  </div>
</section>

${ad('jugador')}

<section class="block">
  <h2>Promedios</h2>
  ${statTable([['Últimos 5', p.log, 5], ['Últimos 10', p.log, 10], ['Últimos 20', p.log, 20], ['Temporada', p.log]])}
</section>

<section class="block">
  <h2>Local y visitante</h2>
  ${statTable([['Local', p.log.filter(e => e.h)], ['Visitante', p.log.filter(e => !e.h)]])}
</section>

${today ? `<section class="block">
  <h2>Historial contra ${esc(oppTeam.name)}</h2>
  ${vsLog.length ? statTable([[`vs ${today.opp.abbr}`, vsLog]]) + gameLog(vsLog, root) : `<p class="empty card">Todavía no se enfrentaron esta temporada.</p>`}
</section>` : ''}

<section class="block">
  <h2>Partido a partido</h2>
  ${gameLog(p.log.slice(0, 20), root)}
</section>

${affiliates()}
<script type="application/json" id="player-data">${JSON.stringify(dataForJs).replace(/</g, '\\u003c')}</script>`,
  });
}

// Equipos
for (const t of teams.values()) {
  const root = '../';
  const r = roster(t.id);
  const today = todayOpp.get(t.id);
  const last = [...t.games].sort((a, b) => b.d.localeCompare(a.d)).slice(0, 10);
  await page({
    path: `equipo/${t.slug}.html`,
    title: `Estadísticas de ${t.name}: plantel, defensa y últimos partidos | ${config.name}`,
    desc: `${t.name}: ${t.gp ? `${t.wins}-${t.gp - t.wins}, ${fmt(t.ppg)} puntos por partido y permite ${fmt(t.def.pts)}` : 'estadísticas de la temporada'}. Promedios de cada jugador y últimos resultados.`,
    body: `
<section class="player-hero card">
  <div class="ph-top">${badge(t, 'lg')}<div><h1>${esc(t.name)}</h1><p class="muted">${t.gp ? `${t.wins} ganados · ${t.gp - t.wins} perdidos` : 'Sin partidos todavía'}</p></div></div>
  ${t.def ? `<div class="bignums">
    <div><span class="big">${fmt(t.ppg)}</span><span class="unit">PTS a favor</span></div>
    <div><span class="big">${fmt(t.def.pts)}</span><span class="unit">PTS en contra</span></div>
    <div><span class="big">#${t.def.ptsRank}</span><span class="unit">Defensa</span></div>
  </div>` : ''}
  ${today ? `<p class="today-pill">Hoy ${today.home ? 'vs' : '@'} <a href="${teamUrl(teams.get(today.opp.id), root)}">${esc(today.opp.name)}</a> · ${fmtTime(today.g.start)}</p>` : ''}
</section>

<section class="block">
  <h2>Plantel</h2>
  <div class="table-wrap"><table class="stats">
  <thead><tr><th scope="col">Jugador</th><th scope="col">PJ</th>${['min', 'pts', 'reb', 'ast', 'fg3m', 'pra'].map(k => `<th scope="col">${STATS[k]}</th>`).join('')}</tr></thead>
  <tbody>${r.map(p => `<tr><th scope="row"><a href="${playerUrl(p, root)}">${esc(p.name)}</a></th><td>${p.log.length}</td>${['min', 'pts', 'reb', 'ast', 'fg3m', 'pra'].map(k => `<td${k === 'pra' ? ' class="hl"' : ''}>${fmt(avg(p.log, k))}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>
  <p class="muted small">Promedios de la temporada.</p>
</section>

${ad('equipo')}

${t.def ? `<section class="block">
  <h2>Defensa: qué permite por partido</h2>
  <div class="defgrid">${[['pts', 'Puntos'], ['reb', 'Rebotes'], ['ast', 'Asistencias'], ['fg3m', 'Triples']].map(([k, l]) => `<div class="card"><span class="big">${fmt(t.def[k])}</span><span class="unit">${l}</span><span class="muted small">#${t.def[k + 'Rank']} de ${ranked.length}</span></div>`).join('')}</div>
  <p class="muted small">Ranking: #1 es el que menos permite.</p>
</section>` : ''}

<section class="block">
  <h2>Últimos partidos</h2>
  <ul class="results card">${last.map(g => { const o = teams.get(g.opp); return `<li><span>${fmtDay(g.d)}</span><span>${g.h ? 'vs' : '@'} <a href="${teamUrl(o, root)}">${esc(o.abbr)}</a></span><span class="${g.pf > g.pa ? 'win' : 'loss'}">${g.pf > g.pa ? 'G' : 'P'} ${g.pf}-${g.pa}</span></li>`; }).join('') || '<li class="muted">Sin partidos todavía</li>'}</ul>
</section>`,
  });
}

// Defensa
{
  const rows = [...ranked].sort((a, b) => a.def.ptsRank - b.def.ptsRank);
  const cell = (t, k) => `<td>${fmt(t.def[k])} <span class="rk">#${t.def[k + 'Rank']}</span></td>`;
  await page({
    path: 'defensa.html',
    title: `Defensa de los equipos NBA: puntos permitidos por partido | ${config.name}`,
    desc: 'Ranking de defensa de los 30 equipos de la NBA: puntos, rebotes, asistencias y triples que permite cada uno por partido. Ideal para elegir props de jugadores.',
    body: `
<section class="block">
  <h1>Defensa de cada equipo</h1>
  <p class="lead">Lo que permite cada equipo por partido. Contra los de abajo de la tabla, a los jugadores rivales les suele ir mejor.</p>
  <div class="table-wrap"><table class="stats def">
  <thead><tr><th scope="col">#</th><th scope="col">Equipo</th><th scope="col">PJ</th><th scope="col">PTS</th><th scope="col">REB</th><th scope="col">AST</th><th scope="col">3PM</th></tr></thead>
  <tbody>${rows.map(t => `<tr><td>${t.def.ptsRank}</td><th scope="row"><a href="${teamUrl(t, '')}">${esc(t.name)}</a></th><td>${t.gp}</td>${cell(t, 'pts')}${cell(t, 'reb')}${cell(t, 'ast')}${cell(t, 'fg3m')}</tr>`).join('')}</tbody>
  </table></div>
  <p class="muted small">Ordenado por puntos permitidos (#1 = mejor defensa). La defensa por posición llega más adelante.</p>
</section>
${ad('defensa')}`,
  });
}

// Todos los jugadores (también es el resultado del buscador sin JavaScript)
{
  const byTeam = [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
  await page({
    path: 'jugadores.html',
    title: `Jugadores NBA: estadísticas de todos los planteles | ${config.name}`,
    desc: 'Lista de todos los jugadores de la NBA con sus estadísticas de la temporada, ordenados por equipo.',
    body: `
<section class="block">
  <h1>Jugadores</h1>
  <p class="lead" id="search-result-msg">Todos los jugadores, por equipo.</p>
  <div class="teams-list">${byTeam.map(t => `<div class="card"><h3><a href="${teamUrl(t, '')}">${esc(t.name)}</a></h3><ul>${roster(t.id).map(p => `<li data-name="${esc(p.name)}"><a href="${playerUrl(p, '')}">${esc(p.name)}</a></li>`).join('')}</ul></div>`).join('')}</div>
</section>`,
  });
}

// Sitemap y robots
const today = new Date().toISOString().slice(0, 10);
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `<url><loc>${config.url}/${p === 'index.html' ? '' : p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
await write('robots.txt', demo ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nSitemap: ${config.url}/sitemap.xml\n`);

console.log(`Sitio generado en ${OUT}/ ${demo ? '(DEMO) ' : ''}: ${pages.length} páginas, ${players.size} jugadores, ${teams.size} equipos, ${todayGames.length} partidos hoy.`);
