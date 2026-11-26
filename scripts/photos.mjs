// Fotos y fichas de los jugadores desde los planteles públicos de ESPN (sin clave, ~31 pedidos).
// Cruza por nombre (y número de camiseta si hay dos iguales) con los jugadores de data/games
// y completa data/profiles.json: foto, posición, altura (m) y peso (kg). No toca lo que ya trae foto.
import { readJson, writeJson, listGameFiles } from './lib.mjs';

const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z]/g, '');
const get = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };

// Nuestros jugadores: id → { name, jersey }
const ours = new Map();
for (const f of await listGameFiles('data/games')) {
  const day = await readJson(`data/games/${f}`);
  for (const g of day?.games ?? []) for (const p of g.players ?? []) ours.set(p.id, { name: p.name, jersey: p.jersey });
}

// Planteles de ESPN
const teams = (await get(`${API}/teams`)).sports[0].leagues[0].teams.map(t => t.team.id);
const byName = new Map();
let failed = 0;
for (const id of teams) {
  try {
    for (const a of (await get(`${API}/teams/${id}/roster`)).athletes ?? []) {
      const k = norm(a.fullName ?? a.displayName);
      byName.set(k, [...(byName.get(k) ?? []), a]);
    }
  } catch { failed++; }
}

const profiles = await readJson('data/profiles.json', {});
let added = 0, missing = 0;
for (const [id, p] of ours) {
  if (profiles[id]?.photo) continue;
  const cands = byName.get(norm(p.name)) ?? [];
  const a = cands.length > 1 ? cands.find(c => Number(c.jersey) === p.jersey) : cands[0];
  if (!a?.headshot?.href) { missing++; continue; }
  profiles[id] = {
    ...profiles[id],
    name: p.name,
    photo: a.headshot.href,
    pos: profiles[id]?.pos || a.position?.abbreviation || null,
    height: profiles[id]?.height || (a.height ? `${(a.height * 0.0254).toFixed(2).replace('.', ',')} m` : null),
    weight: profiles[id]?.weight || (a.weight ? `${Math.round(a.weight * 0.4536)} kg` : null),
    src: 'espn',
  };
  added++;
}
await writeJson('data/profiles.json', profiles);
console.log(`Fotos ESPN: ${added} nuevas, ${missing} sin cruzar, ${failed} planteles fallidos. Total con foto: ${Object.values(profiles).filter(x => x.photo).length}/${ours.size}.`);
