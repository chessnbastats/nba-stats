# Línea Stats · Estadísticas NBA para apostar, en español

Sitio estático que se actualiza solo todos los días con GitHub Actions y se publica gratis en GitHub Pages.

## Qué hay en cada carpeta

| Carpeta / archivo | Para qué sirve |
|---|---|
| `scripts/update.mjs` | Baja partidos y box scores de Highlightly sin pasarse de 90 consultas por día. |
| `scripts/build.mjs` | Arma el sitio en `dist/`: inicio, una página por jugador y por equipo, defensa, sitemap y robots. |
| `scripts/demo.mjs` | Genera datos de ejemplo con jugadores inventados (DEMO) para probar el diseño sin API key. |
| `src/` | Estilos y JavaScript del buscador y del comparador contra la línea. |
| `site.config.mjs` | Nombre del sitio, URL, AdSense y afiliados. Lo que haya que cambiar a mano está acá. |
| `data/games/` | Los datos reales que se van guardando, un archivo por día. |
| `.github/workflows/update.yml` | La tarea automática diaria. |

## Ver el sitio en tu compu (con datos DEMO)

Necesitás Node 20 o más nuevo. En la carpeta del proyecto:

```bash
npm run dev
```

y abrí http://localhost:4321

## Ponerlo online: lo que tenés que hacer vos (una sola vez)

### 1. Cuenta y repositorio en GitHub
1. Entrá a https://github.com/signup y creá la cuenta.
2. Arriba a la derecha: **+ → New repository**. Nombre: `nba-stats`. Marcá **Public** (GitHub Pages gratis necesita repo público). **Create repository**.
3. Subí esta carpeta (te ayudo con eso cuando llegues acá; son tres comandos).

### 2. API key de Highlightly
1. Entrá a https://highlightly.net, creá la cuenta y elegí el plan **Basic (gratis)** de la API de NBA.
2. Copiá tu **API key** del panel.

### 3. Cargar la key como secret
1. En el repo: **Settings → Secrets and variables → Actions → New repository secret**.
2. Name: `HIGHLIGHTLY_KEY` · Secret: la key que copiaste. **Add secret**.
3. En la misma pantalla, pestaña **Variables → New repository variable**: Name `SITE_URL`, valor `https://chessnbastats.github.io/nba-stats`.

> Si sacaste la key por RapidAPI en vez de Highlightly directo, agregá también la variable `HIGHLIGHTLY_BASE` = `https://nba-ncaab-api.p.rapidapi.com`.

### 4. Activar GitHub Pages
1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Pestaña **Actions → Actualizar y publicar → Run workflow**. A los dos minutos el sitio está online.

Desde ahí corre solo todos los días a las 7 de la mañana (hora argentina).

## Cómo cuida el límite de 100 consultas gratis

- 1 consulta para los partidos de hoy.
- Por cada fecha sin completar: 1 consulta para la lista de partidos + 1 por cada partido terminado (box score).
- Arranca por la fecha más reciente y va hacia atrás. Cuando llega a 90 consultas, para y sigue al día siguiente.
- La temporada empezó el 21 de octubre: el relleno completo lleva unos días; después usa ~15 consultas por día.

## Más adelante

- **AdSense:** cuando te aprueben, poné tu `ca-pub-...` en `site.config.mjs` → `adsenseClient`.
- **Afiliados:** cargá cada casa en `affiliates` (solo casas con licencia en Argentina o en Salta).
- **Dominio propio:** Settings → Pages → Custom domain, y cambiá `SITE_URL`.

+18 · Jugá responsablemente.
