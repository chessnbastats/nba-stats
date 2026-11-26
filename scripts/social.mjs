// Publica la imagen del día (dist/share/hoy.png) en las redes que tengan sus claves cargadas.
// Hoy: Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID). Si no hay claves, no hace nada.
// Anota en data/social.json qué día se publicó cada red, para no repetir si el workflow corre dos veces.
import { readFile, writeFile } from 'node:fs/promises';
import { readJson } from './lib.mjs';

// Prueba manual (botón "Run workflow" con prueba = true): publica la imagen de la última fecha jugada.
const TEST = process.env.SOCIAL_TEST === 'true';
const which = TEST ? 'ayer' : 'hoy';
const data = JSON.parse(await readFile(`dist/share/${which}.json`, 'utf8'));
const log = await readJson('data/social.json', {});
const before = JSON.stringify(log);
const num = v => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(v);

if (data.demo || !data.players.length) { console.log('Redes: hoy no hay nada para publicar.'); process.exit(0); }

const caption = [
  `${TEST ? '[Prueba con la fecha pasada] ' : ''}En racha hoy · ${data.day}`,
  '',
  ...data.players.map(p => `• ${p.name} (${p.team} ${p.home ? 'vs' : '@'} ${p.opp}, ${p.time}): más de ${num(p.line)} pts en ${p.over} de sus últimos 5`),
  '',
  `Todas las rachas: ${data.url}/racha-hoy.html`,
  'La línea es su promedio de los últimos 10, no la de una casa de apuestas. +18 · Jugá con responsabilidad.',
].join('\n');

async function telegram() {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) return 'sin claves, no publico';
  if (!TEST && log.telegram === data.date) return 'ya publicado hoy';
  const form = new FormData();
  form.append('chat_id', chat);
  form.append('caption', caption.slice(0, 1024));
  form.append('photo', new Blob([await readFile(`dist/share/${which}.png`)], { type: 'image/png' }), 'sharpi-hoy.png');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram respondió ${r.status}: ${j.description ?? 'error'}`);
  if (!TEST) log.telegram = data.date;
  return 'publicado';
}

// En la prueba también se pone el logo como foto del canal (el bot necesita el permiso "Cambiar información").
async function telegramPhoto() {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) return 'sin claves';
  const form = new FormData();
  form.append('chat_id', chat);
  form.append('photo', new Blob([await readFile('dist/share/avatar.png')], { type: 'image/png' }), 'sharpi.png');
  const r = await fetch(`https://api.telegram.org/bot${token}/setChatPhoto`, { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram respondió ${r.status}: ${j.description ?? 'error'}`);
  return 'foto del canal cambiada';
}

let failed = false;
for (const [name, fn] of [['Telegram', telegram], ...(TEST ? [['Foto del canal', telegramPhoto]] : [])]) {
  try { console.log(`${name}: ${await fn()}.`); }
  catch (e) { failed = true; console.error(`${name}: ${e.message}`); }
}
if (JSON.stringify(log) !== before) await writeFile('data/social.json', JSON.stringify(log, null, 1) + '\n');
if (failed) process.exitCode = 1;
