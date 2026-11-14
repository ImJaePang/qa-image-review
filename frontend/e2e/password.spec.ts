// 임시 비밀번호 → 로그인 → 비밀번호 변경 강제 → 변경 후 정상 사용 흐름을 브라우저로 확인한다. (MAIL_MODE는 꺼져 있어 관리자 화면에 임시 비밀번호가 보인다)
import { expect, test } from '@playwright/test'

test('임시 비밀번호로 로그인하면 변경 화면만 보이고, 바꾸면 원래 화면으로 간다', async ({ page, context }) => {
  // 관리자: 박확인 계정을 임시 비밀번호로 초기화
  await page.goto('/login')
  await page.getByLabel('이메일').fill('admin@example.com')
  await page.getByLabel('비밀번호').fill('1234')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL('**/review/assignments')
  await page.goto('/settings/users')
  await page.getByRole('row', { name: /박확인/ }).getByRole('button', { name: '수정' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '임시 비밀번호로 초기화' }).click()
  const temp = (await dialog.locator('.font-mono').innerText()).trim()
  expect(temp).toHaveLength(10)
  await context.clearCookies()

  // 박확인: 임시 비밀번호로 로그인 → 변경 화면
  await page.goto('/login')
  await page.getByLabel('이메일').fill('qa3@example.com')
  await page.getByLabel('비밀번호').fill(temp)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByText('비밀번호를 변경해 주세요')).toBeVisible()
  await expect(page.getByRole('link', { name: /검수/ })).toHaveCount(0) // 메뉴는 보이지 않는다

  // 입력 검사: 짧음 / 확인 불일치 / 현재 비밀번호 틀림(서버)
  await page.locator('#cp-current').fill(temp)
  await page.locator('#cp-new').fill('short')
  await page.locator('#cp-confirm').fill('short')
  await page.getByRole('button', { name: '비밀번호 변경' }).click()
  await expect(page.getByText('새 비밀번호는 8자 이상이어야 합니다.')).toBeVisible()
  await page.locator('#cp-current').fill('wrong-password')
  await page.locator('#cp-new').fill('new-pass-1234')
  await page.locator('#cp-confirm').fill('new-pass-1234')
  await page.getByRole('button', { name: '비밀번호 변경' }).click()
  await expect(page.getByText('현재 비밀번호가 올바르지 않습니다')).toBeVisible()
  await expect(page.getByText('비밀번호를 변경해 주세요')).toBeVisible() // 로그아웃되지 않는다(400)

  // 정상 변경 → 원래 화면
  await page.locator('#cp-current').fill(temp)
  await page.getByRole('button', { name: '비밀번호 변경' }).click()
  await expect(page.getByText('비밀번호를 변경했습니다')).toBeVisible()
  await expect(page.getByText('비밀번호를 변경해 주세요')).toBeHidden()
  await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()

  // 새 비밀번호로 다시 로그인되고, 상단 메뉴의 변경 창도 열린다
  await page.getByRole('button', { name: '로그아웃' }).click()
  await page.getByLabel('이메일').fill('qa3@example.com')
  await page.getByLabel('비밀번호').fill('new-pass-1234')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL('**/review/assignments')
  await page.getByRole('button', { name: '비밀번호 변경' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: '비밀번호 변경' })).toBeVisible()
})
