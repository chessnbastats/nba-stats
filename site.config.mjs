// Configuración general del sitio. Lo que haya que cambiar a mano, se cambia acá.
export default {
  name: 'Línea Stats',
  tagline: 'Estadísticas NBA para apostar, en español',
  // URL pública final (sin barra al final). En GitHub Actions se toma de la variable SITE_URL.
  url: process.env.SITE_URL || 'https://chessnbastats.github.io/nba-stats',
  // Zona horaria para mostrar los horarios de los partidos.
  displayTimeZone: 'America/Argentina/Buenos_Aires',
  // Google AdSense: cuando te aprueben, poné acá tu "ca-pub-XXXXXXXX". Vacío = se muestran espacios reservados.
  adsenseClient: '',
  // Mail de contacto (AdSense lo pide). Vacío = no se muestra.
  contact: '',
  // Links de afiliados (cuando haya casas con licencia). Vacío = espacio reservado.
  affiliates: [
    // { name: 'Casa X', url: 'https://...', text: 'Apostá en Casa X' },
  ],
};
