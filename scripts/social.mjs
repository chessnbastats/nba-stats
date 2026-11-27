// Publica la imagen del día (dist/share/hoy.png) en las redes que tengan sus claves cargadas.
// Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) e Instagram (IG_TOKEN). Si no hay claves, no hace nada.
// Uso: node scripts/social.mjs [telegram|instagram]  (Instagram va después de publicar la página:
// Meta baja la imagen desde la URL pública).
// Anota en data/social.json qué día se publicó cada red, para no repetir si el workflow corre dos veces.
import { readFile, writeFile } from 'node:fs/promises';
import { readJson } from './lib.mjs';

// Prueba manual (botón "Run workflow" con prueba = true): publica la imagen de la última fecha jugada.
const ONLY = process.argv[2] || 'telegram';
const TEST = process.env.SOCIAL_TEST === 'true';
const PHOTO = process.env.SOCIAL_PHOTO === 'true';
const which = TEST ? 'ayer' : 'hoy';
const data = JSON.parse(await readFile(`dist/share/${which}.json`, 'utf8'));
const log = await readJson('data/social.json', {});
const before = JSON.stringify(log);
const num = v => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(v);

if (!PHOTO && (data.demo || !data.players.length)) { console.log('Redes: hoy no hay nada para publicar.'); process.exit(0); }

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

// Con foto_canal = true se pone el logo como foto del canal (el bot necesita el permiso "Cambiar información").
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

// Instagram (API con login de Instagram, sin página de Facebook): contenedor → esperar → publicar.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const igCaption = [
  `${TEST ? '[Prueba] ' : ''}En racha hoy · ${data.day} 🏀`,
  '',
  ...data.players.map(p => `• ${p.name} (${p.team} ${p.home ? 'vs' : '@'} ${p.opp}): más de ${num(p.line)} pts en ${p.over} de sus últimos 5`),
  '',
  'Todas las rachas y estadísticas, en el link de la bio.',
  'La línea es su promedio de los últimos 10. +18 · Jugá con responsabilidad.',
  '',
  '#NBA #NBAenEspañol #EstadisticasNBA #basquet',
].join('\n');
// El token puede ser de Instagram (empieza con "IG", va a graph.instagram.com) o de Facebook
// (login unificado, va a graph.facebook.com con el id de la cuenta de Instagram).
const IG_TOKEN = (process.env.IG_TOKEN ?? '').trim();
const IG_HOST = IG_TOKEN.startsWith('IG') ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
const IG_USER_ID = process.env.IG_USER_ID || '17841409239486420'; // @sharpistats (dato público)
async function igApi(path, params, method = 'GET') {
  const u = new URL(`${IG_HOST}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: IG_TOKEN });
  const res = method === 'GET' ? await fetch(`${u}?${body}`) : await fetch(u, { method, body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(`Instagram respondió ${res.status}: ${j.error?.message ?? 'error'}`);
  return j;
}
async function instagram() {
  if (!IG_TOKEN) return 'sin claves, no publico';
  if (!TEST && log.instagram === data.date) return 'ya publicado hoy';
  const image_url = `${data.url}/share/${which}.jpg?v=${data.date}-${Date.now()}`;
  // GitHub Pages puede tardar unos segundos en mostrar la imagen nueva.
  for (let i = 0; i < 12; i++) { if ((await fetch(image_url, { method: 'HEAD' })).ok) break; await sleep(10000); }
  const user_id = IG_HOST.includes('instagram') ? (await igApi('me', { fields: 'user_id' })).user_id : IG_USER_ID;
  const { id } = await igApi(`${user_id}/media`, { image_url, caption: igCaption }, 'POST');
  for (let i = 0; i < 30; i++) {
    const { status_code } = await igApi(id, { fields: 'status_code' });
    if (status_code === 'FINISHED') break;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`Instagram no pudo procesar la imagen (${status_code}).`);
    await sleep(10000);
  }
  await igApi(`${user_id}/media_publish`, { creation_id: id }, 'POST');
  if (!TEST) log.instagram = data.date;
  return 'publicado';
}

let failed = false;
const jobs = ONLY === 'instagram' ? [['Instagram', instagram]]
  : PHOTO && !TEST ? [['Foto del canal', telegramPhoto]] : [['Telegram', telegram], ...(PHOTO ? [['Foto del canal', telegramPhoto]] : [])];
for (const [name, fn] of jobs) {
  try { console.log(`${name}: ${await fn()}.`); }
  catch (e) { failed = true; console.error(`${name}: ${e.message}`); }
}
if (JSON.stringify(log) !== before) await writeFile('data/social.json', JSON.stringify(log, null, 1) + '\n');
if (failed) process.exitCode = 1;
