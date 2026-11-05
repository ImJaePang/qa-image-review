import { defineConfig } from '@playwright/test'

// 화면 자동 테스트: 테스트 전용 DB의 API(3201)와 프론트 개발 서버(5273)를 띄워 설치된 크롬으로 실행한다.
const API_PORT = 3201
const WEB_PORT = 5273

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, channel: 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    {
      command: 'node --env-file=../.env test/e2e-server.mjs',
      cwd: '../backend',
      env: { E2E_API_PORT: String(API_PORT) },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      env: { API_PORT: String(API_PORT) },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
