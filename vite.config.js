import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build timestamp in Central European Time, baked into the bundle via text
// substitution so the StartScreen can show "built YYYY-MM-DD HH:mm CET" for
// deploy verification. Europe/Stockholm handles CET/CEST DST transitions
// automatically; we always label the result "CET" (including summer) for
// brand consistency.
function formatCET(date) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')} CET`;
}
const BUILD_TIME = formatCET(new Date());

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/VectorX/',
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
})
