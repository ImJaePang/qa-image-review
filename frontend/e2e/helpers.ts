import type { Page } from '@playwright/test'

/**
 * 이미지를 새로 배정하는 시나리오는 시작할 때 호출한다: 앞선 시나리오가 배정해 둔 이미지를 모두 풀어
 * 테스트 DB의 미배정 이미지가 항상 같은 상태(정상 6 / 의심 3 / 불량 3)로 시작하게 한다. (테스트 서버 전용 경로)
 */
export async function freeImages(page: Page) {
  const r = await page.request.post('/api/__e2e/free-images')
  if (!r.ok()) throw new Error(`배정 비우기 실패: ${r.status()}`)
}
