// Foto de perfil para redes (640x640): el logo sticker sobre fondo oscuro. → dist/share/avatar.png
import { writeFile, mkdir } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
<rect width="640" height="640" fill="#0e0f12"/>
<g transform="translate(320 330) scale(3.7) translate(-75 -36)"><g transform="rotate(-6 75 33)" font-family="Yellowtail" font-size="44" text-anchor="middle">
<text x="75" y="42" fill="#0e0f12" stroke="#0e0f12" stroke-width="15" stroke-linejoin="round">Sharpı</text><circle cx="131.5" cy="19.5" r="10.1" fill="#0e0f12"/>
<text x="75" y="42" fill="#fff" stroke="#fff" stroke-width="11" stroke-linejoin="round">Sharpı</text><circle cx="131.5" cy="19.5" r="8.1" fill="#fff"/>
<path d="M33 54 C60 60, 98 59, 122 49" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round"/>
<text x="75" y="42" fill="#0e0f12">Sharpı</text>
<path d="M33 54 C60 60, 98 59, 122 49" stroke="#c8ff3d" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="131.5" cy="19.5" r="2.6" fill="#c8ff3d"/></g></g>
</svg>`;
await mkdir('dist/share', { recursive: true });
await writeFile('dist/share/avatar.png', new Resvg(svg, { font: { fontFiles: ['assets/fonts/Yellowtail-Regular.ttf'], loadSystemFonts: false } }).render().asPng());
console.log('Foto de perfil: dist/share/avatar.png');
