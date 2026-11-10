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
// Posiciones (de las formaciones). Se agrupan como OverCount: por la primera posición que figura.
const positions = demo ? {} : (await readJson('data/positions.json', {}));
const POS_GROUPS = { G: 'Bases y escoltas', F: 'Aleros y ala-pivotes', C: 'Pivotes' };
const POS_NAMES = { PG: 'Base', SG: 'Escolta', G: 'Base / escolta', SF: 'Alero', PF: 'Ala-pivote', F: 'Alero / ala-pivote', C: 'Pivote' };
const posOf = id => String(positions[id]?.pos ?? '').toUpperCase().split(/[-/ ]/)[0];
const groupOf = id => {
  const a = posOf(id);
  return ['PG', 'SG', 'G'].includes(a) ? 'G' : ['SF', 'PF', 'F'].includes(a) ? 'F' : a === 'C' ? 'C' : null;
};
// URL de cada partido: /partido/2026-11-10-bucks-vs-knicks.html
const gameSlug = g => `${g.date}-${slugify(g.away.short || g.away.abbr)}-vs-${slugify(g.home.short || g.home.abbr)}`;

for (const day of days) {
  for (const g of day.games) {
    for (const t of [g.home, g.away]) {
      const prev = teams.get(t.id);
      teams.set(t.id, { games: [], ...prev, id: t.id, name: t.name, short: t.short, abbr: t.abbr, logo: t.logo || prev?.logo || null, slug: slugify(t.abbr || t.name) });
    }
    if (g.status !== 'final' || !g.players?.length) continue;
    for (const [side, other] of [[g.home, g.away], [g.away, g.home]]) {
      const sumOf = (teamId, k) => g.players.filter(p => p.teamId === teamId && played(p)).reduce((s, p) => s + (p[k] ?? 0), 0);
      // Lo que le hicieron los rivales a este equipo, separado por posición.
      const byPos = {};
      for (const p of g.players) {
        const grp = p.teamId === other.id && played(p) && groupOf(p.id);
        if (!grp) continue;
        byPos[grp] ??= { pts: 0, reb: 0, ast: 0, fg3m: 0 };
        for (const k of ['pts', 'reb', 'ast', 'fg3m']) byPos[grp][k] += p[k] ?? 0;
      }
      teams.get(side.id).games.push({ byPos,
        d: g.date, h: side === g.home, opp: other.id, pf: side.score, pa: other.score, slug: gameSlug(g),
        oreb: sumOf(other.id, 'reb'), oast: sumOf(other.id, 'ast'), o3: sumOf(other.id, 'fg3m'),
        reb: sumOf(side.id, 'reb'), ast: sumOf(side.id, 'ast'), fg3m: sumOf(side.id, 'fg3m'),
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
        tov: p.tov, fgm: p.fgm, ftm: p.ftm, st: p.starter,
        pra: (p.pts ?? 0) + (p.reb ?? 0) + (p.ast ?? 0), g: gameSlug(g),
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
  // Ataque: lo que produce el equipo por partido (1 = el que más produce).
  t.off = n ? {
    pts: t.ppg,
    reb: t.games.reduce((s, g) => s + g.reb, 0) / n,
    ast: t.games.reduce((s, g) => s + g.ast, 0) / n,
    fg3m: t.games.reduce((s, g) => s + g.fg3m, 0) / n,
  } : null;
}
const ranked = [...teams.values()].filter(t => t.def);
for (const k of ['pts', 'reb', 'ast', 'fg3m']) {
  [...ranked].sort((a, b) => a.def[k] - b.def[k]).forEach((t, i) => { t.def[k + 'Rank'] = i + 1; });
  [...ranked].sort((a, b) => b.off[k] - a.off[k]).forEach((t, i) => { t.off[k + 'Rank'] = i + 1; });
}

// Defensa por posición: promedio por partido de lo que permite a cada grupo, sobre los partidos con posiciones.
for (const t of ranked) {
  t.defPos = {};
  for (const grp of Object.keys(POS_GROUPS)) {
    const gs = t.games.filter(g => g.byPos[grp]);
    if (gs.length < 2) continue;
    t.defPos[grp] = { n: gs.length };
    for (const k of ['pts', 'reb', 'ast', 'fg3m']) t.defPos[grp][k] = gs.reduce((s, g) => s + g.byPos[grp][k], 0) / gs.length;
  }
}
const posReady = Object.keys(POS_GROUPS).filter(grp => ranked.filter(t => t.defPos?.[grp]).length >= 20);
for (const grp of posReady) {
  const withData = ranked.filter(t => t.defPos[grp]);
  for (const k of ['pts', 'reb', 'ast', 'fg3m']) {
    [...withData].sort((a, b) => a.defPos[grp][k] - b.defPos[grp][k]).forEach((t, i) => { t.defPos[grp][k + 'Rank'] = i + 1; });
  }
  for (const t of withData) t.defPos[grp].of = withData.length;
}

// Partidos de hoy (fecha NBA). En DEMO, si el día quedó viejo, uso el último programado.
const todayKey = ymd();
let todayDay = days.find(d => d.date === todayKey);
if (!todayDay && demo) todayDay = [...days].reverse().find(d => d.games.some(g => g.status !== 'final'));
const todayGames = (todayDay?.games ?? []).sort((a, b) => a.start.localeCompare(b.start));
const todayOpp = new Map();
for (const g of todayGames) { todayOpp.set(g.home.id, { opp: g.away, home: true, g }); todayOpp.set(g.away.id, { opp: g.home, home: false, g }); }
// Próximo partido de cada equipo (hoy o en los días siguientes del calendario).
const nextGame = new Map(todayOpp);
for (const d of days) {
  if (d.date <= todayKey) continue;
  for (const g of d.games) {
    if (g.status === 'final') continue;
    if (!nextGame.has(g.home.id)) nextGame.set(g.home.id, { opp: g.away, home: true, g });
    if (!nextGame.has(g.away.id)) nextGame.set(g.away.id, { opp: g.home, home: false, g });
  }
}
const lastDay = [...days].reverse().find(d => d.games.some(g => g.status === 'final' && g.players?.length));

const roster = teamId => [...players.values()].filter(p => p.teamId === teamId).sort((a, b) => (avg(b.log, 'pts', 10) ?? 0) - (avg(a.log, 'pts', 10) ?? 0));

// En racha: de los que juegan hoy, los que superaron su propia línea (promedio de los últimos 10,
// redondeado a ,5) en 4 o 5 de sus últimos 5 partidos. El mínimo evita líneas sin sentido (0,5 tapones).
const HOT_STATS = { pts: ['Puntos', 'pts', 5], reb: ['Rebotes', 'reb', 3], ast: ['Asistencias', 'ast', 2], fg3m: ['Triples', 'triples', 1], pra: ['Pts + Reb + Ast', 'PRA', 10] };
function hotPlayers(stat, games = todayGames) {
  const out = [];
  for (const g of games) for (const side of [g.home, g.away]) {
    const opp = side === g.home ? g.away : g.home;
    for (const p of roster(side.id)) {
      if (p.log.length < 5) continue;
      const a10 = avg(p.log, stat, 10);
      if (a10 == null || a10 < HOT_STATS[stat][2]) continue;
      const line = Math.floor(a10) + 0.5;
      const over = p.log.slice(0, 5).filter(e => (e[stat] ?? 0) > line).length;
      if (over >= 3) out.push({ p, g, opp, home: side === g.home, line, over, a5: avg(p.log, stat, 5) });
    }
  }
  out.sort((a, b) => b.over - a.over || (b.a5 - b.line) - (a.a5 - a.line));
  // Con pocos partidos jugados casi nadie llega a 4 de 5: en ese caso se suman los de 3 de 5.
  const strong = out.filter(h => h.over >= 4);
  return strong.length >= 6 ? strong : out;
}

// ---------- Helpers de HTML ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt = v => (v == null ? '–' : nf1.format(v));
const fmtInt = v => (v == null ? '–' : String(v));
const fmtDay = d => new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00Z')).replace('.', '');
const fmtLongDay = d => new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d + 'T12:00:00Z'));
const fmtTime = iso => new Intl.DateTimeFormat('es-AR', { timeZone: config.displayTimeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) + ' hs';
// Cuándo es un partido: "hoy 21:30 hs" o "mié 11 nov · 22:00 hs".
const fmtWhen = g => g.date === todayKey ? fmtTime(g.start) : `${new Intl.DateTimeFormat('es-AR', { timeZone: config.displayTimeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(g.start)).replace(/\./g, '')} · ${fmtTime(g.start)}`;
const fmtLine = v => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(v);
const teamUrl = (t, root) => `${root}equipo/${t.slug}.html`;
const playerUrl = (p, root) => `${root}jugador/${p.slug}.html`;
const gameUrl = (slug, root) => `${root}partido/${slug}.html`;
const hotCard = (h, stat, root) => `<a class="hot card" href="${playerUrl(h.p, root)}?stat=${stat}&amp;n=5&amp;line=${h.line}#comparador">
  <span class="who"><strong>${esc(h.p.name)}${h.over >= 4 ? ' 🔥' : ''}</strong><small>${esc(h.p.team?.abbr)} ${h.home ? 'vs' : '@'} ${esc(h.opp.abbr)} · ${fmtTime(h.g.start)}</small></span>
  <span class="hot-line">Más de ${fmtLine(h.line)} ${HOT_STATS[stat][1]} en <strong>${h.over} de 5</strong> · prom. últ. 5: ${fmt(h.a5)}</span>
</a>`;
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
  <nav><a href="${root}index.html#hoy">Hoy</a><a href="${root}racha-hoy.html">Racha</a><a href="${root}jugadores.html">Jugadores</a><a href="${root}defensa.html">Defensa</a></nav>
</header>
${home ? '' : `<div class="top-search">${searchForm(root)}</div>`}
<main>
${body}
</main>
<footer class="foot">
  <p class="resp"><strong>+18</strong> · Jugá responsablemente. Las estadísticas no garantizan resultados.</p>
  <p>${esc(config.name)} · ${esc(config.tagline)} · Datos actualizados ${esc(fmtLongDay(lastDay?.date ?? todayKey))}.</p>
  <p class="foot-links"><a href="${root}racha-hoy.html">En racha hoy</a><a href="${root}defensa.html">Defensa</a><a href="${root}ataque.html">Ataque</a><a href="${root}jugadores.html">Jugadores</a><a href="${root}como-leer.html">Cómo leer las estadísticas</a><a href="${root}metodologia.html">Acerca de</a><a href="${root}privacidad.html">Privacidad</a></p>
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
  return `<tr><td><a href="${gameUrl(e.g, root)}">${fmtDay(e.d)}</a></td><td class="opp">${e.h ? 'vs' : '@'} <a href="${teamUrl(t, root)}">${esc(e.opp)}</a></td><td class="${e.w ? 'win' : 'loss'}">${e.w ? 'G' : 'P'} ${esc(e.sc)}</td>${Object.keys(STATS).map(k => `<td${k === 'pra' ? ' class="hl"' : ''}>${k === 'min' ? fmt(e.min) : fmtInt(e[k])}</td>`).join('')}</tr>`;
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
  <a class="game-link" href="${gameUrl(gameSlug(g), '')}">Previa del partido →</a>
</article>`;
  };

  const hotToday = hotPlayers('pts');
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

${hotToday.length ? `<section class="block">
  <div class="block-head"><h2>🔥 En racha hoy</h2><a href="racha-hoy.html">Ver todas las rachas →</a></div>
  <div class="hots">${hotToday.slice(0, 8).map(h => hotCard(h, 'pts', '')).join('')}</div>
  <p class="muted small">Jugadores de hoy que superaron su propia línea de puntos (su promedio de los últimos 10, redondeado a ,5) en la mayoría de sus últimos 5 partidos. 🔥 = 4 o 5 de 5.</p>
</section>` : ''}

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

<section class="block ctas">
  <a class="cta card" href="defensa.html"><strong>Defensa de cada equipo</strong><span>Qué rivales permiten más puntos, rebotes, asistencias y triples →</span></a>
  <a class="cta card alt" href="ataque.html"><strong>Ataque de cada equipo</strong><span>Quién anota más, reparte más y tira más triples →</span></a>
</section>

${affiliates()}`,
  });
}

// Jugadores
for (const p of players.values()) {
  const path = `jugador/${p.slug}.html`;
  const root = '../';
  const t = p.team;
  const today = t && nextGame.get(t.id); // hoy o el próximo partido
  const grp = groupOf(p.id);
  const starts = p.log.filter(e => e.st != null);
  const vsLog = today ? p.log.filter(e => e.oppId === today.opp.id) : [];
  const oppTeam = today && teams.get(today.opp.id);
  const l10 = k => fmt(avg(p.log, k, 10));
  const dataForJs = {
    name: p.name, team: t?.abbr, todayOpp: today ? today.opp.abbr : null,
    log: p.log.map(({ d, opp, h, w, min, pts, reb, ast, fg3m, stl, blk, tov, fgm, ftm }) => ({ d, opp, h, w, min, pts, reb, ast, fg3m, stl, blk, tov, fgm, ftm })),
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
      <p class="muted">${t ? `<a href="${teamUrl(t, root)}">${esc(t.name)}</a>` : ''}${p.jersey ? ` · #${esc(p.jersey)}` : ''} ${POS_NAMES[posOf(p.id)] ? ` · ${POS_NAMES[posOf(p.id)]}` : ''} · ${p.log.length} partidos esta temporada${starts.length ? ` · titular en ${starts.filter(e => e.st).length} de ${starts.length}` : ''}</p>
    </div>
  </div>
  <div class="bignums">
    ${['pts', 'reb', 'ast', 'pra'].map(k => `<div><span class="big">${l10(k)}</span><span class="unit">${STATS[k]}</span></div>`).join('')}
  </div>
  <p class="muted small">Promedio de los últimos ${Math.min(10, p.log.length)} partidos</p>
  ${today ? `<p class="today-pill">${today.g.date === todayKey ? 'Hoy' : 'Próximo:'} ${today.home ? 'vs' : '@'} <a href="${teamUrl(oppTeam, root)}">${esc(oppTeam.name)}</a> · ${fmtWhen(today.g)}${oppTeam.def ? ` · defensa #${oppTeam.def.ptsRank} (permite ${fmt(oppTeam.def.pts)} pts)` : ''}${grp && oppTeam.defPos?.[grp]?.ptsRank ? ` · contra ${POS_GROUPS[grp].toLowerCase()}: #${oppTeam.defPos[grp].ptsRank} (permite ${fmt(oppTeam.defPos[grp].pts)} pts)` : ''} · <a href="${gameUrl(gameSlug(today.g), root)}">previa</a></p>` : ''}
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
          <option value="blk">Tapones</option><option value="sb">Robos + Tapones</option><option value="tov">Pérdidas</option>
          <option value="fgm">Tiros de campo convertidos</option><option value="ftm">Libres convertidos</option>
          <option value="fant">Fantasy</option><option value="min">Minutos</option>
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
    <h3 class="cmp-sub">Con esta línea</h3>
    <div class="hitgrid"></div>
    <button type="button" class="copy-link">Copiar link de esta consulta</button>
    <details class="vsline-wrap"><summary>Partido a partido contra la línea</summary><div class="vsline"></div></details>
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
  const today = nextGame.get(t.id);
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
  ${today ? `<p class="today-pill">${today.g.date === todayKey ? 'Hoy' : 'Próximo:'} ${today.home ? 'vs' : '@'} <a href="${teamUrl(teams.get(today.opp.id), root)}">${esc(today.opp.name)}</a> · ${fmtWhen(today.g)} · <a href="${gameUrl(gameSlug(today.g), root)}">previa</a></p>` : ''}
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
</section>
<section class="block">
  <h2>Ataque: qué produce por partido</h2>
  <div class="defgrid">${[['pts', 'Puntos'], ['reb', 'Rebotes'], ['ast', 'Asistencias'], ['fg3m', 'Triples']].map(([k, l]) => `<div class="card"><span class="big">${fmt(t.off[k])}</span><span class="unit">${l}</span><span class="muted small">#${t.off[k + 'Rank']} de ${ranked.length}</span></div>`).join('')}</div>
  <p class="muted small">Ranking: #1 es el que más produce.</p>
</section>` : ''}

<section class="block">
  <h2>Últimos partidos</h2>
  <ul class="results card">${last.map(g => { const o = teams.get(g.opp); return `<li><a href="${gameUrl(g.slug, root)}">${fmtDay(g.d)}</a><span>${g.h ? 'vs' : '@'} <a href="${teamUrl(o, root)}">${esc(o.abbr)}</a></span><span class="${g.pf > g.pa ? 'win' : 'loss'}">${g.pf > g.pa ? 'G' : 'P'} ${g.pf}-${g.pa}</span></li>`; }).join('') || '<li class="muted">Sin partidos todavía</li>'}</ul>
</section>`,
  });
}

// Defensa
{
  const rows = [...ranked].sort((a, b) => a.def.ptsRank - b.def.ptsRank);
  const cell = (t, k) => `<td>${fmt(t.def[k])} <span class="rk">#${t.def[k + 'Rank']}</span></td>`;
  const posCell = (d, k) => `<td>${fmt(d[k])} <span class="rk">#${d[k + 'Rank']}</span></td>`;
  const posSections = posReady.length ? `<section class="block" id="por-posicion">
  <h2>Defensa por posición</h2>
  <p class="lead">Lo que permite cada equipo por partido a cada posición. Sirve para ver, por ejemplo, contra quién le conviene jugar a un pivote.</p>
  <nav class="seg jump" aria-label="Posiciones">${posReady.map(grp => `<a href="#pos-${grp}">${POS_GROUPS[grp]}</a>`).join('')}</nav>
  ${posReady.map(grp => {
    const list = ranked.filter(t => t.defPos[grp]?.ptsRank).sort((x, y) => x.defPos[grp].ptsRank - y.defPos[grp].ptsRank);
    return `<h3 id="pos-${grp}">Contra ${POS_GROUPS[grp].toLowerCase()}</h3>
  <div class="table-wrap"><table class="stats def">
  <thead><tr><th scope="col">#</th><th scope="col">Equipo</th><th scope="col">PTS</th><th scope="col">REB</th><th scope="col">AST</th><th scope="col">3PM</th></tr></thead>
  <tbody>${list.map(t => `<tr><td>${t.defPos[grp].ptsRank}</td><th scope="row"><a href="${teamUrl(t, '')}">${esc(t.name)}</a></th>${posCell(t.defPos[grp], 'pts')}${posCell(t.defPos[grp], 'reb')}${posCell(t.defPos[grp], 'ast')}${posCell(t.defPos[grp], 'fg3m')}</tr>`).join('')}</tbody>
  </table></div>`;
  }).join('')}
  <p class="muted small">Posición según la formación del partido; se agrupa por la primera que figura. #1 = el que menos permite. Se calcula sobre los partidos en los que conocemos las posiciones.</p>
</section>` : '';
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
  <p class="muted small">Ordenado por puntos permitidos (#1 = mejor defensa).</p>
</section>
${posSections}
${ad('defensa')}`,
  });
}

// Ataque
{
  const rows = [...ranked].sort((a, b) => a.off.ptsRank - b.off.ptsRank);
  const cell = (t, k) => `<td>${fmt(t.off[k])} <span class="rk">#${t.off[k + 'Rank']}</span></td>`;
  await page({
    path: 'ataque.html',
    title: `Ataque de los equipos NBA: puntos por partido | ${config.name}`,
    desc: 'Ranking de ataque de los 30 equipos de la NBA: puntos, rebotes, asistencias y triples por partido de cada uno.',
    body: `
<section class="block">
  <h1>Ataque de cada equipo</h1>
  <p class="lead">Lo que produce cada equipo por partido. Los equipos de arriba juegan partidos de más goleo: más chances para los overs de sus jugadores.</p>
  <div class="table-wrap"><table class="stats def">
  <thead><tr><th scope="col">#</th><th scope="col">Equipo</th><th scope="col">PJ</th><th scope="col">PTS</th><th scope="col">REB</th><th scope="col">AST</th><th scope="col">3PM</th></tr></thead>
  <tbody>${rows.map(t => `<tr><td>${t.off.ptsRank}</td><th scope="row"><a href="${teamUrl(t, '')}">${esc(t.name)}</a></th><td>${t.gp}</td>${cell(t, 'pts')}${cell(t, 'reb')}${cell(t, 'ast')}${cell(t, 'fg3m')}</tr>`).join('')}</tbody>
  </table></div>
  <p class="muted small">Ordenado por puntos anotados (#1 = el que más anota). Ver también la <a href="defensa.html">defensa de cada equipo</a>.</p>
</section>
${ad('ataque')}`,
  });
}

// En racha hoy, por estadística
{
  const sections = Object.entries(HOT_STATS).map(([stat, [label]]) => {
    const list = hotPlayers(stat);
    return `<section class="block" id="${stat}">
  <h2>${label}</h2>
  ${list.length ? `<div class="hots">${list.slice(0, 12).map(h => hotCard(h, stat, '')).join('')}</div>` : '<p class="empty card">Hoy nadie viene en racha en esta estadística.</p>'}
</section>`;
  });
  await page({
    path: 'racha-hoy.html',
    title: `Jugadores NBA en racha hoy: puntos, rebotes, asistencias y triples | ${config.name}`,
    desc: 'Los jugadores de los partidos de hoy que superaron su línea en 4 o 5 de sus últimos 5 partidos, en puntos, rebotes, asistencias, triples y PRA.',
    body: `
<section class="block">
  <h1>🔥 En racha hoy</h1>
  <p class="lead">${todayGames.length ? `Jugadores de los ${todayGames.length} partidos de hoy que superaron su propia línea en la mayoría de sus últimos 5 partidos (🔥 = 4 o 5 de 5).` : 'Hoy no hay partidos de NBA.'}</p>
  <nav class="seg jump" aria-label="Estadísticas">${Object.entries(HOT_STATS).map(([k, [l]]) => `<a href="#${k}">${l}</a>`).join('')}</nav>
</section>
${sections.join('\n')}
<p class="muted small">La línea de cada jugador es su promedio de los últimos 10 partidos redondeado a ,5. No es la línea de ninguna casa de apuestas: cargá la tuya en el comparador de cada jugador. <a href="como-leer.html">Cómo leer estas estadísticas</a>.</p>
${ad('racha')}`,
  });
}

// Partidos: previa si no se jugó, planilla completa si ya terminó.
for (const day of days) {
  for (const g of day.games) {
    const root = '../';
    const final = g.status === 'final' && g.players?.length;
    const sides = [g.away, g.home];
    const header = `<section class="player-hero card">
  <p class="muted small">${esc(fmtLongDay(g.date))}${final ? '' : ` · ${fmtTime(g.start)} (hora de Argentina)`}</p>
  <div class="matchup">
    <a class="team" href="${teamUrl(teams.get(g.away.id), root)}">${badge(g.away, 'lg')}<span class="abbr">${esc(g.away.name)}</span></a>
    <div class="vs">${final ? `<strong>${g.away.score} – ${g.home.score}</strong><small>Final</small>` : '<strong>@</strong>'}</div>
    <a class="team" href="${teamUrl(teams.get(g.home.id), root)}">${badge(g.home, 'lg')}<span class="abbr">${esc(g.home.name)}</span></a>
  </div>
</section>`;
    const cols = ['min', 'pts', 'reb', 'ast', 'fg3m', 'stl', 'blk'];
    const boxTable = side => {
      const ps = g.players.filter(p => p.teamId === side.id && played(p)).sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));
      return `<h3>${esc(side.name)}</h3><div class="table-wrap"><table class="stats">
<thead><tr><th scope="col">Jugador</th>${cols.map(k => `<th scope="col">${STATS[k]}</th>`).join('')}</tr></thead>
<tbody>${ps.map(p => { const pl = players.get(p.id); return `<tr><th scope="row">${pl ? `<a href="${playerUrl(pl, root)}">${esc(p.name)}</a>` : esc(p.name)}</th>${cols.map(k => `<td>${k === 'min' ? fmt(p.min) : fmtInt(p[k])}</td>`).join('')}</tr>`; }).join('')}</tbody>
</table></div>`;
    };
    const previewTable = side => {
      const r = roster(side.id).filter(p => p.log.length).slice(0, 10);
      return `<h3><a href="${teamUrl(teams.get(side.id), root)}">${esc(side.name)}</a></h3><div class="table-wrap"><table class="stats">
<thead><tr><th scope="col">Jugador</th><th scope="col">PTS 5</th><th scope="col">PTS 10</th><th scope="col">REB</th><th scope="col">AST</th><th scope="col">3PM</th><th scope="col">PRA</th></tr></thead>
<tbody>${r.map(p => `<tr><th scope="row"><a href="${playerUrl(p, root)}">${esc(p.name)}</a></th><td>${fmt(avg(p.log, 'pts', 5))}</td><td>${fmt(avg(p.log, 'pts', 10))}</td>${['reb', 'ast', 'fg3m'].map(k => `<td>${fmt(avg(p.log, k, 10))}</td>`).join('')}<td class="hl">${fmt(avg(p.log, 'pra', 10))}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin datos todavía</td></tr>'}</tbody>
</table></div>`;
    };
    const teamCtx = side => {
      const t = teams.get(side.id);
      return `<div class="card ctx"><h3>${esc(t.name)}</h3>${t.def ? `<p>Defensa <strong>#${t.def.ptsRank}</strong> · permite ${fmt(t.def.pts)} pts</p><p>Ataque <strong>#${t.off.ptsRank}</strong> · anota ${fmt(t.off.pts)} pts</p><p class="muted small">Permite ${fmt(t.def.reb)} reb (#${t.def.rebRank}), ${fmt(t.def.ast)} ast (#${t.def.astRank}) y ${fmt(t.def.fg3m)} triples (#${t.def.fg3mRank})</p>${posReady.length ? `<p class="muted small">Puntos que permite: ${posReady.filter(grp => t.defPos?.[grp]?.ptsRank).map(grp => `${POS_GROUPS[grp].toLowerCase()} ${fmt(t.defPos[grp].pts)} (#${t.defPos[grp].ptsRank})`).join(' · ')}</p>` : ''}` : '<p class="muted">Sin datos todavía</p>'}</div>`;
    };
    const hots = final ? [] : Object.keys(HOT_STATS).flatMap(stat => hotPlayers(stat, [g]).map(h => ({ h, stat })));
    const title = final
      ? `${g.away.name} ${g.away.score}-${g.home.score} ${g.home.name} (${fmtDay(g.date)}): estadísticas del partido | ${config.name}`
      : `${g.away.name} vs ${g.home.name} (${fmtDay(g.date)}): previa y estadísticas | ${config.name}`;
    await page({
      path: `partido/${gameSlug(g)}.html`,
      title,
      desc: final
        ? `Planilla completa de ${g.away.name} vs ${g.home.name} del ${fmtDay(g.date)}: puntos, rebotes, asistencias y triples de cada jugador.`
        : `Previa de ${g.away.name} vs ${g.home.name}: promedios de los jugadores, defensa y ataque de cada equipo y jugadores en racha.`,
      body: `${header}
${final ? `<section class="block"><h2>Estadísticas del partido</h2>${sides.map(boxTable).join('')}</section>` : `
${hots.length ? `<section class="block"><h2>🔥 En racha</h2><div class="hots">${hots.slice(0, 8).map(({ h, stat }) => hotCard(h, stat, root)).join('')}</div></section>` : ''}
<section class="block"><h2>Cómo llegan</h2><div class="ctxgrid">${sides.map(teamCtx).join('')}</div></section>
<section class="block"><h2>Jugadores</h2>${sides.map(previewTable).join('')}<p class="muted small">PTS 5 y PTS 10: promedio de puntos en los últimos 5 y 10 partidos. El resto, últimos 10.</p></section>`}
${ad('partido')}`,
    });
  }
}

// Guía, metodología y privacidad (AdSense las pide para aprobar un sitio)
await page({
  path: 'como-leer.html',
  title: `Cómo leer las estadísticas para apostar en la NBA | ${config.name}`,
  desc: 'Guía simple para usar el comparador contra la línea: qué es una línea, qué significa superarla en 7 de 10 partidos y qué mirar además del promedio.',
  body: `<article class="block prose">
<h1>Cómo leer las estadísticas</h1>
<h2>Qué es la línea</h2>
<p>En las apuestas a jugadores, la casa propone un número, por ejemplo <strong>24,5 puntos</strong>, y vos elegís si el jugador va a hacer <strong>más</strong> (over) o <strong>menos</strong> (under). Como la línea casi siempre termina en ,5, no hay empate.</p>
<h2>Qué muestra el comparador</h2>
<p>En la ficha de cada jugador elegís la estadística y cargás la línea. Ves en cuántos de sus últimos partidos la superó, por ejemplo <em>"superó 24,5 en 7 de 10"</em>, y una barra por partido: <strong>verde</strong> si pasó la línea, <strong>roja</strong> si no.</p>
<h2>Qué mirar además del promedio</h2>
<ul>
<li><strong>La mediana:</strong> si un jugador hizo 50 puntos una noche, el promedio sube mucho, pero la mediana no. Si el promedio y la mediana están lejos, desconfiá.</li>
<li><strong>La cantidad de partidos:</strong> 4 de 5 suena bien, pero son pocos partidos. Mirá también los últimos 10 y 20.</li>
<li><strong>Local y visitante:</strong> hay jugadores que rinden bastante distinto según dónde juegan.</li>
<li><strong>El rival:</strong> en la página de <a href="defensa.html">defensa</a> ves qué equipos permiten más puntos, rebotes, asistencias y triples.</li>
<li><strong>Los minutos:</strong> si un jugador viene jugando menos minutos, es difícil que mantenga sus números.</li>
</ul>
<h2>En racha</h2>
<p>En <a href="racha-hoy.html">En racha hoy</a> mostramos los jugadores de los partidos del día que superaron su propia línea en 4 o 5 de sus últimos 5 partidos. Esa línea es su promedio de los últimos 10, redondeado a ,5, no la línea de una casa de apuestas.</p>
<p class="resp-box"><strong>+18 · Jugá responsablemente.</strong> Los resultados pasados no garantizan lo que va a pasar. Apostá solo lo que estés dispuesto a perder.</p>
</article>`,
});
await page({
  path: 'metodologia.html',
  title: `Acerca de ${config.name} y metodología | ${config.name}`,
  desc: `De dónde salen los datos de ${config.name}, cada cuánto se actualizan y cómo se calcula cada estadística.`,
  body: `<article class="block prose">
<h1>Acerca de ${esc(config.name)}</h1>
<p>${esc(config.name)} es un sitio gratuito de estadísticas de la NBA en español, pensado para quienes apuestan a jugadores. No somos una casa de apuestas ni damos pronósticos: mostramos números para que cada uno saque sus conclusiones.</p>
<h2>De dónde salen los datos</h2>
<p>Las estadísticas de cada partido se obtienen de un proveedor de datos deportivos y se actualizan automáticamente una vez por día, a la mañana (hora de Argentina). Los partidos del día se muestran con horario de Argentina.</p>
<h2>Cómo se calcula cada cosa</h2>
<ul>
<li><strong>Promedio de los últimos N:</strong> la suma de los últimos N partidos que jugó, dividida por N. No cuentan los partidos en los que no jugó.</li>
<li><strong>Superó la línea:</strong> cuenta solo los partidos en los que hizo <em>más</em> que la línea. Si iguala la línea, no cuenta como superada.</li>
<li><strong>PRA:</strong> puntos + rebotes + asistencias.</li>
<li><strong>Fantasy:</strong> puntos + 1,2 × rebotes + 1,5 × asistencias + 3 × robos + 3 × tapones − pérdidas.</li>
<li><strong>Defensa:</strong> lo que permite cada equipo a sus rivales por partido. #1 es el que menos permite.</li>
<li><strong>Ataque:</strong> lo que produce cada equipo por partido. #1 es el que más produce.</li>
</ul>
<p>Puede haber errores o demoras en los datos. Si ves algo raro, confirmalo antes de apostar.</p>
<p>${esc(config.name)} no tiene relación con la NBA ni con sus equipos.</p>
</article>`,
});
await page({
  path: 'privacidad.html',
  title: `Política de privacidad | ${config.name}`,
  desc: `Qué datos recolecta ${config.name} y cómo se usan las cookies.`,
  body: `<article class="block prose">
<h1>Política de privacidad</h1>
<p>${esc(config.name)} no pide registrarse y no recolecta datos personales como nombre, mail o teléfono.</p>
<h2>Cookies y publicidad</h2>
<p>Este sitio puede mostrar anuncios de Google AdSense. Google y sus socios usan cookies para mostrar anuncios según las visitas anteriores a este y otros sitios. Podés desactivar los anuncios personalizados en <a href="https://adssettings.google.com" rel="noopener">la configuración de anuncios de Google</a>. Más información en <a href="https://policies.google.com/technologies/ads" rel="noopener">cómo usa Google las cookies en publicidad</a>.</p>
<h2>Links a otros sitios</h2>
<p>Algunos links pueden llevar a sitios de terceros, como casas de apuestas con licencia. Cada sitio tiene su propia política de privacidad.</p>
<h2>Menores de edad</h2>
<p>Este sitio está dirigido a mayores de 18 años.</p>
${config.contact ? `<h2>Contacto</h2><p>Por consultas sobre esta política: <a href="mailto:${esc(config.contact)}">${esc(config.contact)}</a>.</p>` : ''}
</article>`,
});

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
