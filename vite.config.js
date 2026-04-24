import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build timestamp baked into the bundle via text substitution so the
// StartScreen can show "built YYYY-MM-DD HH:mm UTC" for deploy verification.
const BUILD_TIME = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/VectorX/',
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
})
