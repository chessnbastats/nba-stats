// Dibuja la imagen diaria para redes (1080x1350, formato vertical de Instagram) a partir de dist/share/hoy.json.
// Uso: node scripts/build.mjs && node scripts/card.mjs   → dist/share/hoy.png
import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const which = process.argv[2] || 'hoy';
const data = JSON.parse(await readFile(process.env.CARD_JSON || `dist/share/${which}.json`, 'utf8'));
const W = 1080, H = 1350;
const C = { bg: '#0e0f12', ink: '#f4f1e8', muted: '#8c919c', line: '#262932', accent: '#c8ff3d', paper: '#ece6d6', paperInk: '#17140f', riso: '#33451a' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(v);
const initials = n => String(n).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const shortDay = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
  .format(new Date(data.date + 'T12:00:00Z')).replace(/\./g, '').toUpperCase();

// Fotos: se bajan y se meten adentro del SVG. Si alguna falla, quedan las iniciales.
async function photoUri(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || 'image/png';
    if (!type.startsWith('image/')) return null;
    return `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch { return null; }
}

const LOGO = `<g transform="translate(52 40) scale(2.3) rotate(-6 75 33)" font-family="Yellowtail" font-size="44" text-anchor="middle">
<text x="75" y="42" fill="${C.bg}" stroke="${C.bg}" stroke-width="15" stroke-linejoin="round">Sharpı</text><circle cx="131.5" cy="19.5" r="10.1" fill="#0e0f12"/>
<text x="75" y="42" fill="#fff" stroke="#fff" stroke-width="11" stroke-linejoin="round">Sharpı</text><circle cx="131.5" cy="19.5" r="8.1" fill="#fff"/>
<path d="M33 54 C60 60, 98 59, 122 49" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round"/>
<text x="75" y="42" fill="${C.bg}">Sharpı</text>
<path d="M33 54 C60 60, 98 59, 122 49" stroke="${C.accent}" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="131.5" cy="19.5" r="2.6" fill="#c8ff3d"/></g>`;

const ROW_Y = 470, ROW_H = 148;
async function row(p, i) {
  const y = ROW_Y + i * ROW_H, cy = y + ROW_H / 2, cx = 124, r = 62;
  const img = await photoUri(p.photo);
  const face = img
    ? `<clipPath id="f${i}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
       <circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.paper}"/>
       <image href="${img}" x="${cx - 1.6 * r}" y="${cy - 0.92 * r}" width="${3.2 * r}" height="${3.2 * r * 760 / 1040}" preserveAspectRatio="xMidYMid meet" clip-path="url(#f${i})"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.paper}"/>
       <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="Barlow Condensed" font-weight="900" font-style="italic" font-size="42" fill="${C.paperInk}">${esc(initials(p.name))}</text>`;
  const boxes = p.hits.map((h, k) => {
    const x = 760 + k * 40, by = cy + 18;
    return h ? `<rect x="${x}" y="${by}" width="30" height="30" fill="${C.accent}"/>`
      : `<rect x="${x + 1.5}" y="${by + 1.5}" width="27" height="27" fill="none" stroke="${C.muted}" stroke-width="3" stroke-dasharray="6 4"/>`;
  }).join('');
  return `<g>
  <g transform="rotate(${i % 2 ? 3 : -3} ${cx} ${cy})">${face}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="5"/></g>
  <text x="214" y="${cy - 6}" font-family="Barlow" font-weight="700" font-size="44" fill="${C.ink}">${esc(p.name)}</text>
  <text x="216" y="${cy + 40}" font-family="Space Mono" font-weight="700" font-size="24" fill="${C.muted}">${esc(p.team)} ${p.home ? 'vs' : '@'} ${esc(p.opp)} · ${esc(p.time)}</text>
  <text x="1020" y="${cy - 2}" text-anchor="end" font-family="Barlow Condensed" font-weight="900" font-style="italic" font-size="64" fill="${C.accent}">+${num(p.line)}<tspan font-size="30" fill="${C.ink}" dx="8">PTS</tspan></text>
  ${boxes}
  <text x="1020" y="${cy + 42}" text-anchor="end" font-family="Space Mono" font-weight="700" font-size="22" fill="${C.ink}">${p.over}/5</text>
  ${i < data.players.length - 1 ? `<line x1="60" y1="${y + ROW_H}" x2="1020" y2="${y + ROW_H}" stroke="${C.line}" stroke-width="3" stroke-dasharray="14 10"/>` : ''}
</g>`;
}

const rows = (await Promise.all(data.players.map(row))).join('\n');
const site = data.url.replace(/^https?:\/\//, '');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${C.bg}"/>
${LOGO}
<g transform="rotate(4 900 110)"><rect x="770" y="80" width="260" height="58" fill="${C.paper}" opacity=".92"/>
<text x="900" y="120" text-anchor="middle" font-family="Space Mono" font-weight="700" font-size="28" fill="${C.paperInk}">${esc(shortDay)}</text></g>
<g font-family="Barlow Condensed" font-weight="900" font-style="italic" font-size="122">
<text x="66" y="330" fill="${C.riso}">EN RACHA HOY</text>
<text x="60" y="324" fill="${C.ink}">EN RACHA <tspan fill="${C.accent}">HOY</tspan></text></g>
<text x="64" y="404" font-family="Caveat" font-size="58" fill="${C.accent}" transform="rotate(-2 64 404)">pasaron su línea de puntos en sus últimos 5</text>
<path d="M985 352 C 992 380, 990 400, 984 426 M970 410 L984 428 L999 409" stroke="${C.accent}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
${data.players.length ? rows : `<text x="540" y="800" text-anchor="middle" font-family="Barlow" font-weight="700" font-size="44" fill="${C.ink}">${data.games === 0 ? 'Hoy no hay partidos.' : 'Hoy nadie viene en racha.'}</text>`}
<line x1="60" y1="1222" x2="1020" y2="1222" stroke="${C.ink}" stroke-width="3"/>
<text x="60" y="1268" font-family="Space Mono" font-weight="700" font-size="24" fill="${C.ink}">${esc(site)}</text>
<text x="60" y="1306" font-family="Barlow" font-weight="600" font-size="22" fill="${C.muted}">Línea = su promedio de los últimos 10, no la de una casa. +18 · Jugá con responsabilidad.</text>
</svg>`;

const fonts = ['Yellowtail-Regular', 'BarlowCondensed-BlackItalic', 'Barlow-Bold', 'Barlow-SemiBold', 'SpaceMono-Bold', 'Caveat'].map(f => `assets/fonts/${f}.ttf`);
const png = new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Barlow' } }).render().asPng();
await writeFile(`dist/share/${which}.png`, png);
await writeFile(`dist/share/${which}.svg`, svg);
console.log(`Imagen: dist/share/${which}.png (${data.players.length} jugadores, ${Math.round(png.length / 1024)} KB).`);
