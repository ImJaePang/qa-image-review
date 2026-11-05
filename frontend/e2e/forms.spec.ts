// 폼 채우기 방식을 바꾼 5곳(사용자 수정, 권한 수정, 연계 추가, 규칙 입력칸, 권한별 메뉴 표)이 화면에서 제대로 동작하는지 확인한다.
import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('이메일').fill('admin@example.com')
  await page.getByLabel('비밀번호').fill('1234')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL('**/review/assignments')
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
})

test('사용자 수정: 열면 그 사용자 값이 채워지고, 다른 사용자를 열면 바뀐다', async ({ page }) => {
  await page.goto('/settings/users')
  const dialog = page.getByRole('dialog')
  await page.getByRole('row', { name: /김검수/ }).getByRole('button', { name: '수정' }).click()
  await expect(dialog.getByRole('heading', { name: '사용자 수정 — 김검수' })).toBeVisible()
  await expect(dialog.locator('#u-name')).toHaveValue('김검수')
  // 입력 중인 값을 수정한 뒤 닫았다가 다른 사용자를 열면 그 사용자의 값으로 바뀐다
  await dialog.locator('#u-name').fill('임시 이름')
  await dialog.getByRole('button', { name: '닫기' }).first().click()
  await expect(dialog).toBeHidden()
  await page.getByRole('row', { name: /박확인/ }).getByRole('button', { name: '수정' }).click()
  await expect(dialog.getByRole('heading', { name: '사용자 수정 — 박확인' })).toBeVisible()
  await expect(dialog.locator('#u-name')).toHaveValue('박확인')
})

test('권한 수정: 새 권한은 빈 폼이고, 수정은 값이 채워지며, 다시 새 권한을 열면 비워진다', async ({ page }) => {
  await page.goto('/settings/roles')
  const dialog = page.getByRole('dialog')
  await page.getByRole('button', { name: '새 권한' }).click()
  await expect(dialog.locator('#r-code')).toHaveValue('')
  await dialog.locator('#r-code').fill('auditor')
  await dialog.locator('#r-label').fill('감사')
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('row', { name: /^QA\s/ }).getByRole('button', { name: '수정' }).click()
  await expect(dialog.getByRole('heading', { name: /권한 수정 — QA/ })).toBeVisible()
  await expect(dialog.locator('#r-label')).toHaveValue('QA')
  await dialog.getByRole('button', { name: '닫기' }).first().click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: '새 권한' }).click()
  await expect(dialog.locator('#r-code')).toHaveValue('')
  await expect(dialog.locator('#r-label')).toHaveValue('')
})

test('연계 추가: 폴더 제안값이 채워지고, 닫았다 다시 열면 입력이 초기화된다', async ({ page }) => {
  await page.goto('/settings/integrations')
  const dialog = page.getByRole('dialog')
  await page.getByRole('button', { name: '연계 추가' }).first().click()
  await expect(dialog.locator('#watchDir')).toHaveValue('source-1/inbox')
  await expect(dialog.locator('#doneDir')).toHaveValue('source-1/done')
  await dialog.locator('#name').fill('임시 연계')
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: '연계 추가' }).first().click()
  await expect(dialog.locator('#name')).toHaveValue('')
  await expect(dialog.locator('#watchDir')).toHaveValue('source-1/inbox')
})

test('규칙: 입력칸이 활성 규칙 값으로 시작하고, 새 버전을 저장하면 그 값이 유지된다', async ({ page }) => {
  await page.goto('/settings/rules')
  const normal = page.getByRole('textbox').nth(0)
  const suspect = page.getByRole('textbox').nth(1)
  await expect(normal).toHaveValue('0.9')
  await expect(suspect).toHaveValue('0.5')
  await normal.fill('0.85')
  await suspect.fill('0.4')
  await page.getByRole('button', { name: '새 버전으로 저장' }).click()
  await expect(page.getByText('정상 ≥ 0.85 · 의심 ≥ 0.40').first()).toBeVisible()
  // 새 버전이 활성이 된 뒤에도 입력칸이 새 활성 값으로 맞춰져 있다
  await expect(normal).toHaveValue('0.85')
  await expect(suspect).toHaveValue('0.4')
  await page.reload()
  await expect(page.getByRole('textbox').nth(0)).toHaveValue('0.85')
})

test('권한별 메뉴: 체크를 바꾸면 변경 표시가 되고, 되돌리기로 원래대로, 저장하면 서버 값으로 유지된다', async ({ page }) => {
  await page.goto('/settings/menus')
  const box = page.getByRole('checkbox', { name: '연구원: 대시보드' })
  const original = await box.isChecked()
  await box.setChecked(!original)
  await expect(box).toBeChecked({ checked: !original })
  await page.getByRole('button', { name: '되돌리기' }).click()
  await expect(box).toBeChecked({ checked: original })

  await box.setChecked(!original)
  await page.getByRole('button', { name: '저장' }).click()
  await expect(page.getByText(/저장했습니다|저장되었습니다/).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: '연구원: 대시보드' })).toBeChecked({ checked: !original })
})
