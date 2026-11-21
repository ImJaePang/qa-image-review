// 이미지 목록: 판정 칩(건수)으로 거르고, 검색·정렬하고, 행을 눌러 크게 본다(보기 전용: 승인/반려 없음).
// 테스트 DB 픽스처: 이미지 12장 = 정상 6 / 의심 3 / 불량 3 (점수 낮은 순으로 불량 0.2, 0.3, 0.4)
import { expect, test } from '@playwright/test'

test('이미지 목록: 판정 필터·정렬·검색·크게 보기', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('이메일').fill('admin@example.com')
  await page.getByLabel('비밀번호').fill('1234')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL('**/review/assignments')

  await page.getByRole('link', { name: '데이터', exact: true }).click()
  await page.getByRole('link', { name: '이미지 목록' }).click()
  await expect(page.getByRole('heading', { name: '이미지 목록' })).toBeVisible()

  // 판정 칩의 건수
  await expect(page.getByRole('button', { name: /^전체\s*12$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^불량\s*3$/ })).toBeVisible()

  // 불량만 → 3줄, 점수 낮은 순으로 정렬하면 0.20이 맨 위
  await page.getByRole('button', { name: /^불량/ }).click()
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(3)
  await page.getByRole('combobox', { name: '정렬' }).click()
  await page.getByRole('option', { name: '점수 낮은 순' }).click()
  await expect(rows.first()).toContainText('0.20')

  // 검색: 파일명으로 한 장
  await page.getByRole('button', { name: /^전체/ }).click()
  await page.getByPlaceholder('파일명 · 이미지 번호 검색').fill('tank_12')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('tank_12.png')
  await page.getByPlaceholder('파일명 · 이미지 번호 검색').fill('')
  await expect(rows).toHaveCount(12)

  // 크게 보기: 보기 전용이라 승인/반려가 없고, 이전/다음으로 넘길 수 있다
  await rows.first().click()
  const stage = page.getByTestId('lightbox-stage')
  await expect(stage).toBeVisible()
  await expect(page.getByRole('button', { name: /^승인|^반려|^✓ 승인|^✕ 반려/ })).toHaveCount(0)
  await expect(page.getByText('1 / 12')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('2 / 12')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(stage).toBeHidden()
})

// 쪽의 끝에서 '다음'을 누르면 다음 쪽을 불러와 크게 보기를 연 채로 이어 본다.
// 픽스처가 12장뿐이라 목록 요청의 쪽 크기를 5로 바꿔(5·5·2) 쪽 경계를 만든다.
test('이미지 목록: 크게 보기는 쪽을 넘어도 닫히지 않는다', async ({ page }) => {
  await page.route('**/api/image-list?*', (route) => {
    const url = new URL(route.request().url())
    url.searchParams.set('pageSize', '5')
    return route.continue({ url: url.toString() })
  })
  await page.goto('/login')
  await page.getByLabel('이메일').fill('admin@example.com')
  await page.getByLabel('비밀번호').fill('1234')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL('**/review/assignments')
  await page.goto('/data/images')
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(5)

  await rows.nth(4).click()
  const stage = page.getByTestId('lightbox-stage')
  await expect(page.getByText('5 / 12')).toBeVisible()
  const name = page.getByRole('dialog').getByText(/\.png$/).first()
  const fifth = await name.textContent()
  await page.keyboard.press('ArrowRight') // 2쪽의 첫 장
  await expect(page.getByText('6 / 12')).toBeVisible()
  await expect(stage).toBeVisible()
  await expect(name).not.toHaveText(fifth!)
  await page.keyboard.press('ArrowLeft') // 다시 1쪽의 끝
  await expect(page.getByText('5 / 12')).toBeVisible()
  await expect(name).toHaveText(fifth!)
  // 마지막 장에서는 더 넘어가지 않는다
  for (let n = 6; n <= 12; n++) {
    await page.keyboard.press('ArrowRight')
    await expect(page.getByText(`${n} / 12`)).toBeVisible()
  }
  await expect(page.getByLabel('다음', { exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(stage).toBeHidden()
  await expect(rows).toHaveCount(2) // 목록도 보고 있던 쪽(3쪽)에 있다
})
