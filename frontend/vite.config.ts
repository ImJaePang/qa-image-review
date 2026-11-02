import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 개발 중에는 같은 출처로 보이도록 API와 파일을 백엔드(3000)로 프록시한다 (쿠키 세션, CORS 불필요)
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/files': 'http://127.0.0.1:3000' } },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
