import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    proxy: {
      // Proxies /api/* and /uploads/* to EC2 in dev so VITE_API_BASE_URL=/api works locally
      '/api': {
        target: 'http://13.233.48.251',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://13.233.48.251',
        changeOrigin: true,
      },
    },
  },
})
