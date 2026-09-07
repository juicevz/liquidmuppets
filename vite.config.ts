import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.LIQUIDMUPPETS_API_PROXY ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4317,
    strictPort: true,
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true },
      '/proof': { target: apiProxyTarget, changeOrigin: true },
    },
  },
  preview: {
    port: 4318,
    strictPort: true,
  },
})
