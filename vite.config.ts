import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this app from /captcha-hell/.
// Override with BASE_PATH=/ for other hosts.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? '/captcha-hell/',
})
