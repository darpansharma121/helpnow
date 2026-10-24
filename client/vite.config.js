import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api/v1': process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3002',
      '/socket.io': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3002',
        ws: true
      }
    }
  }
})
