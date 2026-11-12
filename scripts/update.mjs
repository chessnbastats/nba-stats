// Baja partidos y box scores de Highlightly respetando el límite diario de consultas.
// Uso: HIGHLIGHTLY_KEY=xxxx node scripts/update.mjs
//
// Orden de prioridad (para no pasarse de las ~100 consultas gratis por día):
//   1. Partidos de hoy (1 consulta).
//   2. Fechas sin completar, de la más reciente a la más vieja (1 consulta por fecha + 1 por partido terminado).
// Lo que no entra hoy queda para la corrida de mañana: así se rellena solo la temporada ya jugada.
import { STAT_MAP, SEASON_START, NBA_TZ, num, gameStatus, ymd, addDays, readJson, writeJson, listGameFiles } from './lib.mjs';

const KEY = process.env.HIGHLIGHTLY_KEY;
const BASE = (process.env.HIGHLIGHTLY_BASE || 'https://nba.highlightly.net').replace(/\/$/, '');
const RAPID_HOST = process.env.HIGHLIGHTLY_RAPIDAPI_HOST || (BASE.includes('rapidapi') ? new URL(BASE).host : '');
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS || 90);
const DIR = 'data/games';

if (!KEY) {
  console.error('Falta la API key. Definí HIGHLIGHTLY_KEY (en GitHub: Settings > Secrets > Actions).');
  process.exit(1);
}

class BudgetError extends Error {}
let used = 0, emptyBoxes = 0, goodBoxes = 0;

async function api(path, params = {}) {
  if (used >= MAX_REQUESTS) throw new BudgetError('Se llegó al límite de consultas de hoy.');
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { 'x-rapidapi-key': KEY };
  if (RAPID_HOST) headers['x-rapidapi-host'] = RAPID_HOST;
  used++;
  const res = await fetch(url, { headers });
  if (res.status === 429) throw new BudgetError('La API respondió 429 (límite alcanzado).');
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} en ${path}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  // En el plan gratis algunos resultados pueden venir ocultos; lo avisamos para revisarlo.
  const planMsg = json?.plan?.message;
  if (planMsg && !/all data available/i.test(planMsg)) console.warn(`  Aviso del plan (${path}): ${planMsg}`);
  return json;
}

const team = (t = {}) => ({ id: t.id, name: t.displayName || t.name, short: t.name, abbr: t.abbreviation, logo: t.logo || null });
const sumScore = s => (Array.isArray(s) ? (s.length ? s.reduce((a, b) => a + (num(b) || 0), 0) : null) : num(s));

function normalizeMatch(m) {
  return {
    id: m.id,
    date: ymd(new Date(m.date)),
    start: m.date,
    status: gameStatus(m.state?.description),
    statusText: m.state?.description || '',
    home: { ...team(m.homeTeam), score: sumScore(m.state?.score?.homeTeam) },
    away: { ...team(m.awayTeam), score: sumScore(m.state?.score?.awayTeam) },
    players: [],
  };
}

// Los nombres llegan con o sin la sigla entre paréntesis ("Total Rebounds" o "Total Rebounds (REB)").
const statName = s => String(s ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
const STAT_KEYS = Object.fromEntries(Object.entries(STAT_MAP).map(([k, v]) => [statName(k), v]));

function normalizeBox(res) {
  // La API real manda [{team:{id,name}, boxScores:[...]}]; la documentación muestra los boxScores
  // adentro de team o sin team. Aceptamos las tres formas.
  const sides = Array.isArray(res) ? res : res?.data ?? [];
  const players = [];
  for (const side of sides) {
    const t = side.team ?? side;
    for (const b of side.boxScores ?? t.boxScores ?? []) {
      const p = { id: b.player?.id, name: b.player?.name, jersey: b.player?.jersey ?? null, teamId: t.id };
      for (const s of b.statistics ?? []) {
        const key = STAT_KEYS[statName(s.name)];
        if (key) p[key] = num(s.value);
      }
      if (p.id != null && p.name) players.push(p);
    }
  }
  return players;
}

async function fetchDay(day, previous) {
  const res = await api('/matches', { league: 'NBA', date: day, timezone: NBA_TZ, limit: 100 });
  const old = new Map((previous?.games ?? []).map(g => [g.id, g]));
  const games = (res.data ?? []).map(m => {
    const g = { ...normalizeMatch(m), date: day };
    const before = old.get(g.id);
    if (before?.players?.length) g.players = before.players;
    if (before?.lineupDone) g.lineupDone = true;
    return g;
  });
  const file = { date: day, demo: false, complete: false, updatedAt: new Date().toISOString(), games };
  const save = () => writeJson(`${DIR}/${day}.json`, file);
  await save();

  for (const g of games) {
    if (g.status !== 'final' || g.players.length) continue;
    const res = await api(`/box-score/${g.id}`);
    g.players = normalizeBox(res);
    if (!g.players.length) {
      emptyBoxes++;
      console.warn(`  Box score vacío para el partido ${g.id}. Respuesta: ${JSON.stringify(res).slice(0, 700)}`);
      // Si los primeros vienen vacíos, algo cambió en la API: cortamos para no gastar el cupo del día.
      if (emptyBoxes >= 2 && !goodBoxes) throw new BudgetError('Los box scores vienen vacíos: se corta para no gastar consultas.');
      continue;
    }
    goodBoxes++;
    // Los jugadores tienen que quedar asociados a los ids de equipo del partido.
    const ids = [...new Set(g.players.map(p => p.teamId))];
    if (!ids.every(id => id === g.home.id || id === g.away.id) && ids.length === 2) {
      const names = (Array.isArray(res) ? res : res.data ?? []).map(s => (s.team ?? s).name);
      const toMatch = id => {
        const name = names[ids.indexOf(id)] ?? '';
        if (g.home.short && name.includes(g.home.short)) return g.home.id;
        if (g.away.short && name.includes(g.away.short)) return g.away.id;
        return ids.indexOf(id) === 0 ? g.home.id : g.away.id;
      };
      for (const p of g.players) p.teamId = toMatch(p.teamId);
    }
    // Si el marcador vino vacío, lo calculamos sumando los puntos de los jugadores.
    for (const side of [g.home, g.away]) {
      if (side.score == null) side.score = g.players.filter(p => p.teamId === side.id).reduce((s, p) => s + (p.pts || 0), 0);
    }
    await save();
  }
  file.complete = games.every(g => g.status === 'postponed' || (g.status === 'final' && g.players.length > 0));
  await save();
  const done = games.filter(g => g.players.length).length;
  console.log(`  ${day}: ${games.length} partidos, ${done} con box score${file.complete ? ' (completo)' : ''}`);
}

// Formaciones: de acá salen la posición de cada jugador y si fue titular.
// La documentación muestra {home:{team, lineup:[{player, position, positionAbbreviation, isStarter}]}, away};
// como ya pasó con el box score, leemos varias formas posibles.
function parseLineups(res) {
  const root = res?.data && !Array.isArray(res.data) ? res.data : res;
  const sides = Array.isArray(root) ? root : [root?.home, root?.away];
  const out = [];
  for (const side of sides.filter(Boolean)) {
    for (const x of side.lineup ?? side.lineups ?? side.players ?? []) {
      const name = x.player?.name ?? x.player?.fullName ?? (typeof x.player === 'string' ? x.player : x.name ?? x.fullName);
      const pos = x.positionAbbreviation ?? x.position?.abbreviation ?? x.player?.positionAbbreviation ?? (typeof x.position === 'string' ? x.position : null);
      out.push({ ids: [x.player?.id, x.playerId, x.id].filter(v => v != null), name, pos, starter: x.isStarter === true });
    }
  }
  return out;
}

const normName = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const MAX_LINEUPS = Number(process.env.MAX_LINEUPS || 40);

// Pide formaciones de los partidos más recientes que tengan jugadores sin posición conocida.
async function updatePositions() {
  const path = 'data/positions.json';
  const positions = await readJson(path, {});
  let calls = 0, empty = 0, found = 0;
  for (const f of (await listGameFiles(DIR)).reverse()) {
    const file = await readJson(`${DIR}/${f}`);
    let changed = false;
    for (const g of file.games) {
      if (g.status !== 'final' || !g.players?.length || g.lineupDone) continue;
      if (calls >= MAX_LINEUPS || MAX_REQUESTS - used < 1) { if (changed) await writeJson(`${DIR}/${f}`, file); await writeJson(path, positions); return found; }
      calls++;
      const res = await api(`/lineups/${g.id}`);
      const list = parseLineups(res);
      if (!list.length) {
        empty++;
        console.warn(`  Formación vacía para el partido ${g.id}. Respuesta: ${JSON.stringify(res).slice(0, 700)}`);
        if (empty >= 2 && !found) { await writeJson(path, positions); console.warn('  Las formaciones vienen vacías: se corta para no gastar consultas.'); return 0; }
        continue;
      }
      // Se asocia por id del jugador y, si no coincide, por nombre.
      for (const p of g.players) {
        const l = list.find(x => x.ids.includes(p.id)) ?? list.find(x => normName(x.name) === normName(p.name));
        if (!l) continue;
        if (l.pos) {
          // La API da el puesto de ese partido (a veces un pivote figura como base):
          // se cuentan todos los partidos y queda el puesto más repetido.
          const prev = positions[p.id];
          const n = prev?.n ?? (prev ? { [prev.pos]: 1 } : {});
          n[l.pos] = (n[l.pos] ?? 0) + 1;
          const pos = Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
          if (!prev) found++;
          positions[p.id] = { pos, name: p.name, n };
        }
        p.starter = l.starter;
      }
      g.lineupDone = true;
      changed = true;
    }
    if (changed) await writeJson(`${DIR}/${f}`, file);
  }
  await writeJson(path, positions);
  return found;
}

const today = ymd();
const existing = new Set(await listGameFiles(DIR));
console.log(`Actualizando (hoy NBA: ${today}, máximo ${MAX_REQUESTS} consultas)`);

try {
  const todayFile = await readJson(`${DIR}/${today}.json`);
  await fetchDay(today, todayFile);

  // Calendario de los próximos 3 días: para mostrar el próximo partido de cada jugador.
  for (let i = 1; i <= 3; i++) {
    const day = addDays(today, i);
    await fetchDay(day, await readJson(`${DIR}/${day}.json`));
  }

  for (let day = addDays(today, -1); day >= SEASON_START; day = addDays(day, -1)) {
    const prev = existing.has(`${day}.json`) ? await readJson(`${DIR}/${day}.json`) : null;
    if (prev?.complete) continue;
    if (MAX_REQUESTS - used < 2) break; // no alcanza ni para la fecha + un box score
    await fetchDay(day, prev);
  }

  // Con lo que sobra del cupo: posiciones y titulares.
  if (MAX_REQUESTS - used >= 1) console.log(`  Posiciones: ${await updatePositions()} jugadores con posición nueva.`);
} catch (e) {
  if (!(e instanceof BudgetError)) throw e;
  console.log(`  ${e.message} Lo que falta se baja en la próxima corrida.`);
}

const pending = [];
for (let day = addDays(today, -1); day >= SEASON_START; day = addDays(day, -1)) {
  if (!(await readJson(`${DIR}/${day}.json`))?.complete) pending.push(day);
}
console.log(`Listo: ${used} consultas usadas.${pending.length ? ` Faltan ${pending.length} fechas por completar.` : ' Temporada al día.'}`);
