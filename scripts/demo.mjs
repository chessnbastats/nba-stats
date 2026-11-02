// Genera datos de ejemplo (jugadores INVENTADOS, marcados como DEMO) para probar el diseño sin API key.
// Uso: node scripts/demo.mjs   ->   data/demo/games/YYYY-MM-DD.json
import { rm } from 'node:fs/promises';
import { SEASON_START, ymd, addDays, writeJson } from './lib.mjs';

const OUT = 'data/demo/games';

const TEAMS = [
  ['ATL', 'Atlanta Hawks'], ['BOS', 'Boston Celtics'], ['BKN', 'Brooklyn Nets'], ['CHA', 'Charlotte Hornets'],
  ['CHI', 'Chicago Bulls'], ['CLE', 'Cleveland Cavaliers'], ['DAL', 'Dallas Mavericks'], ['DEN', 'Denver Nuggets'],
  ['DET', 'Detroit Pistons'], ['GSW', 'Golden State Warriors'], ['HOU', 'Houston Rockets'], ['IND', 'Indiana Pacers'],
  ['LAC', 'LA Clippers'], ['LAL', 'Los Angeles Lakers'], ['MEM', 'Memphis Grizzlies'], ['MIA', 'Miami Heat'],
  ['MIL', 'Milwaukee Bucks'], ['MIN', 'Minnesota Timberwolves'], ['NOP', 'New Orleans Pelicans'], ['NYK', 'New York Knicks'],
  ['OKC', 'Oklahoma City Thunder'], ['ORL', 'Orlando Magic'], ['PHI', 'Philadelphia 76ers'], ['PHX', 'Phoenix Suns'],
  ['POR', 'Portland Trail Blazers'], ['SAC', 'Sacramento Kings'], ['SAS', 'San Antonio Spurs'], ['TOR', 'Toronto Raptors'],
  ['UTA', 'Utah Jazz'], ['WAS', 'Washington Wizards'],
].map(([abbr, name], i) => ({ id: 1000 + i, abbr, name, short: name.split(' ').pop(), logo: null }));

const FIRST = ['Mateo', 'Lucas', 'Tomás', 'Bruno', 'Iker', 'Dante', 'Thiago', 'Enzo', 'Marco', 'Nico', 'Joaquín', 'Ramiro',
  'Darius', 'Malik', 'Jalen', 'Trey', 'Andre', 'Kofi', 'Luka', 'Nikola', 'Goran', 'Sasha', 'Emeka', 'Theo', 'Rafael', 'Ivo',
  'Deshawn', 'Caleb', 'Omar', 'Felipe'];
const LAST = ['Arriaga', 'Benítez', 'Corvalán', 'Duarte', 'Echeverry', 'Ferreyra', 'Galíndez', 'Herrera', 'Ibarra', 'Jofré',
  'Kowalski', 'Lombardi', 'Mendoza', 'Núñez', 'Okafor', 'Pradenas', 'Quiroga', 'Rivadeneira', 'Sosa', 'Tolosa', 'Urquiza',
  'Valdivia', 'Whitfield', 'Ximénez', 'Yáñez', 'Zárate', 'Brooks', 'Carter', 'Dawson', 'Ellison', 'Fontaine', 'Grayson',
  'Holloway', 'Iverson', 'Jovanović', 'Kerrigan', 'Lindqvist', 'Moreau', 'Novak', 'Odom'];

// Generador pseudoaleatorio con semilla: los datos salen siempre iguales.
let seed = 20261021;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rand() * a.length)];
const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5; // aprox. normal entre -1 y 1
const vary = (base, spread) => Math.max(0, Math.round(base * (1 + gauss() * spread)));

// Perfiles por rol: [pts, reb, ast, 3pm, stl, blk, min]
const ROLES = [
  [27, 6, 6, 2.8, 1.2, 0.6, 35], [21, 5, 4, 2.2, 1.0, 0.5, 33], [17, 9, 3, 1.0, 0.8, 1.3, 31],
  [13, 4, 5, 1.8, 1.0, 0.3, 28], [11, 7, 2, 0.8, 0.6, 1.0, 24], [9, 3, 3, 1.4, 0.7, 0.2, 21],
  [7, 4, 1, 0.6, 0.5, 0.6, 16], [5, 2, 2, 0.7, 0.4, 0.1, 12], [3, 2, 1, 0.3, 0.2, 0.3, 8],
];

const usedNames = new Set();
let nextPlayerId = 50000;
const rosters = new Map();
for (const team of TEAMS) {
  const strength = 0.9 + rand() * 0.2;
  rosters.set(team.id, ROLES.map(role => {
    let name;
    do { name = `${pick(FIRST)} ${pick(LAST)}`; } while (usedNames.has(name));
    usedNames.add(name);
    const k = strength * (0.85 + rand() * 0.3);
    return { id: nextPlayerId++, name, jersey: String(Math.floor(rand() * 45)), role: role.map((v, i) => (i === 6 ? v : v * k)) };
  }));
}

function playGame(home, away) {
  const players = [];
  for (const team of [home, away]) {
    const homeBoost = team === home ? 1.04 : 0.97;
    for (const p of rosters.get(team.id)) {
      if (rand() < 0.04) continue; // no jugó
      const [pts, reb, ast, fg3, stl, blk, min] = p.role;
      const m = Math.min(44, vary(min, 0.15));
      const fg3m = vary(fg3 * homeBoost, 0.6);
      const p2 = vary(pts * homeBoost, 0.32);
      const ftm = Math.round(p2 * 0.18);
      const fgm = Math.max(0, Math.round((p2 - ftm - fg3m * 3) / 2)) + fg3m;
      const points = (fgm - fg3m) * 2 + fg3m * 3 + ftm;
      const r = vary(reb, 0.38);
      players.push({
        id: p.id, name: p.name, jersey: p.jersey, teamId: team.id,
        min: m, pts: points, fgm, fga: Math.round(fgm / 0.47), fg3m, fg3a: Math.round(fg3m / 0.36),
        ftm, fta: Math.round(ftm / 0.78), reb: r, oreb: Math.round(r * 0.25), dreb: r - Math.round(r * 0.25),
        ast: vary(ast * homeBoost, 0.4), stl: vary(stl, 0.8), blk: vary(blk, 0.8), tov: vary(2, 0.6), pf: vary(2.2, 0.5), pm: null,
      });
    }
  }
  const score = id => players.filter(p => p.teamId === id).reduce((s, p) => s + p.pts, 0);
  let hs = score(home.id); const as = score(away.id);
  if (hs === as) { const top = players.find(p => p.teamId === home.id); top.pts += 2; top.fgm += 1; hs += 2; }
  for (const p of players) p.pm = (p.teamId === home.id ? 1 : -1) * (hs - as) + Math.round(gauss() * 5);
  return { hs, as, players };
}

function matchups() {
  const pool = [...TEAMS].sort(() => rand() - 0.5);
  return Array.from({ length: 5 + Math.floor(rand() * 5) }, (_, i) => [pool[i * 2], pool[i * 2 + 1]]);
}

const today = ymd();
await rm(OUT, { recursive: true, force: true });
let gameId = 900000, files = 0;
for (let day = SEASON_START; day <= today; day = addDays(day, 1)) {
  const isToday = day === today;
  const games = matchups().map(([home, away], i) => {
    // Entre las 19:00 y las 21:30 de Nueva York (23:00Z en adelante).
    const start = new Date(Date.parse(`${day}T23:00:00Z`) + ((i % 3) * 60 + (i % 2) * 30) * 60000).toISOString();
    const base = { id: gameId++, date: day, start, home: { ...home, score: null }, away: { ...away, score: null } };
    if (isToday) return { ...base, status: 'scheduled', statusText: 'Scheduled', players: [] };
    const { hs, as, players } = playGame(home, away);
    return { ...base, status: 'final', statusText: 'Finished', home: { ...home, score: hs }, away: { ...away, score: as }, players };
  });
  await writeJson(`${OUT}/${day}.json`, { date: day, demo: true, complete: !isToday, updatedAt: new Date().toISOString(), games });
  files++;
}
console.log(`DEMO: ${files} días generados en ${OUT} (hasta ${today}, con los partidos de hoy programados).`);
