// Renueva el token de Instagram (dura 60 días; se renueva los lunes, o siempre con FORCE=true).
// Escribe el token nuevo en la salida estándar; el workflow lo guarda en el secreto IG_TOKEN.
// Si no hay IG_TOKEN o no hay GH_TOKEN (permiso para guardar el secreto), no hace nada:
// así nunca se renueva un token que después no se pueda guardar.
const { IG_TOKEN, GH_TOKEN, FORCE } = process.env;
if (!IG_TOKEN || !GH_TOKEN) { console.error('Token de Instagram: sin claves, no renuevo.'); process.exit(0); }
if (FORCE !== 'true' && new Date().getUTCDay() !== 1) { console.error('Token de Instagram: se renueva los lunes.'); process.exit(0); }
const u = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(IG_TOKEN)}`;
const r = await fetch(u);
const j = await r.json().catch(() => ({}));
if (!j.access_token) { console.error(`Token de Instagram: no se pudo renovar (${j.error?.message ?? r.status}).`); process.exit(1); }
console.error(`Token de Instagram: renovado por ${Math.round(j.expires_in / 86400)} días.`);
process.stdout.write(j.access_token);
