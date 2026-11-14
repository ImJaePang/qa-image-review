// 대시보드: 관리자는 전체 현황과 미배정 검수 대상을, QA는 내 검수 대기와 내 것만의 현황을 본다.
// 차트는 표로도 볼 수 있다. (테스트 DB의 이미지는 12장 고정)
import { expect, test, type Page } from '@playwright/test'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill('1234')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL('**/review/assignments')
}

test('관리자 대시보드: 전체 현황, 미배정 검수 대상, 차트 ↔ 표', async ({ page }) => {
  await login(page, 'admin@example.com')
  await page.getByRole('link', { name: '홈', exact: true }).click()
  await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible()

  await expect(page.getByText('수신·판정이 끝난 전체 이미지 12장')).toBeVisible()
  await expect(page.getByText('아직 배정하지 않은 검수 대상')).toBeVisible() // 배정 관리 권한이 있을 때만
  await expect(page.getByRole('img', { name: /^정상 6장, 의심 3장, 불량 3장$/ })).toBeVisible()

  // 최근 7일: 차트 → 표(같은 값 7줄) → 차트
  await expect(page.getByRole('img', { name: /^최근 7일 검수 건수/ })).toBeVisible()
  await page.getByRole('button', { name: '표로 보기' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(7)
  await page.getByRole('button', { name: '차트로 보기' }).click()
  await expect(page.getByRole('img', { name: /^최근 7일 검수 건수/ })).toBeVisible()
})

test('QA 대시보드: 내 것만 보이고 배정 관리 카드는 없다', async ({ page }) => {
  await login(page, 'qa1@example.com')
  await page.getByRole('link', { name: '홈', exact: true }).click()
  await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible()
  await expect(page.getByText('내 검수 대기')).toBeVisible()
  await expect(page.getByText('내게 배정된 이미지', { exact: false })).toBeVisible()
  await expect(page.getByText('아직 배정하지 않은 검수 대상')).toHaveCount(0)
})
