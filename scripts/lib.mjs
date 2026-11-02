// Utilidades compartidas entre update, demo y build.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Las fechas de los partidos se agrupan con la hora de Nueva York (la "fecha NBA").
export const NBA_TZ = 'America/New_York';
export const SEASON_START = process.env.SEASON_START || '2026-10-21';

// Nombres de estadísticas de Highlightly -> claves cortas.
export const STAT_MAP = {
  'Total Minutes Played': 'min',
  'Total Points Scored': 'pts',
  'Successful Field Goals (FGM)': 'fgm',
  'Total Field Goals (FGA)': 'fga',
  'Successful 3PT Field Goals (3PM)': 'fg3m',
  'Total 3PT Field Goals (3PA)': 'fg3a',
  'Successful Free Throws (FTM)': 'ftm',
  'Total Free Throws (FTA)': 'fta',
  'Total Rebounds (REB)': 'reb',
  'Total Assists (AST)': 'ast',
  'Total Turnovers (TOV)': 'tov',
  'Total Steals (STL)': 'stl',
  'Total Blocks (BLK)': 'blk',
  'Total Offensive Rebounds (OREB)': 'oreb',
  'Total Defensive Rebounds (DREB)': 'dreb',
  'Total Fouls (PF)': 'pf',
  'Plus Minus (+/-)': 'pm',
};

// El valor puede venir como número, texto ("12", "+5", "34:12") o null.
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const mmss = s.match(/^(\d+):(\d{1,2})$/);
  if (mmss) return Math.round((+mmss[1] + +mmss[2] / 60) * 10) / 10;
  const n = Number(s.replace(',', '.').replace(/^\+/, ''));
  return Number.isFinite(n) ? n : null;
}

export function gameStatus(description = '') {
  const d = description.toLowerCase();
  if (/finish|final|ended|after/.test(d)) return 'final';
  if (/postpon|cancel|suspend|abandon/.test(d)) return 'postponed';
  if (/schedul|not started|tbd|time to be/.test(d)) return 'scheduled';
  return 'live';
}

export function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function ymd(date = new Date(), tz = NBA_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 1) + '\n');
}

export async function listGameFiles(dir) {
  try {
    return (await readdir(dir)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  } catch { return []; }
}
