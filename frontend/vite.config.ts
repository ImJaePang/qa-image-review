import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 개발 중에는 같은 출처로 보이도록 API를 백엔드로 프록시한다 (쿠키 세션, CORS 불필요). 포트는 API_PORT(기본 3000)
  // 윈도우가 3000을 예약해 EACCES가 나는 PC에서는 API_PORT=3101 로 백엔드와 프론트를 같이 띄운다
  server: { proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 3000}` } },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
