// 핵심 흐름: 관리자가 배정을 만들고 → QA가 점검·승인/반려 → 점검 완료 → 관리자가 확인 완료.
// 화면·서버·DB가 실제로 맞물려 도는지 사람이 하는 순서 그대로 확인한다. (테스트 DB의 미배정 이미지: 의심 3 + 불량 3)
import { expect, test, type Page } from '@playwright/test'

const TITLE = '핵심 흐름 시험 배정'
const COUNT = 5

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill('1234')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL('**/review/assignments')
}

async function logout(page: Page) {
  await page.getByRole('button', { name: '로그아웃' }).click()
  await page.waitForURL('**/login')
}

const openAssignment = (page: Page) => page.getByRole('row', { name: new RegExp(TITLE) }).click()

test('배정 → 점검 시작 → 승인/반려 → 점검 완료 → 확인 완료', async ({ page }) => {
  // ── 관리자: 신규 배정 ──
  await login(page, 'admin@example.com')
  await page.getByRole('button', { name: /신규 배정/ }).first().click()
  const modal = page.getByRole('dialog')
  await modal.locator('#t').fill(TITLE)
  await modal.getByRole('combobox').click()
  await page.getByRole('option', { name: '김검수' }).click()
  await modal.locator('#d').fill('2030-01-31')
  await modal.locator('#c').fill(String(COUNT))
  await modal.getByRole('button', { name: '배정하기' }).click()
  await expect(page.getByText(`배정 완료 (${COUNT}장 → 김검수)`)).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(TITLE) })).toContainText('배정')
  await logout(page)

  // ── QA: 내 배정에서 점검 시작 ──
  await login(page, 'qa1@example.com')
  await page.getByRole('link', { name: '내 배정' }).click()
  await expect(page.getByRole('heading', { name: '내 배정' })).toBeVisible()
  await expect(page.getByRole('button', { name: /신규 배정/ })).toHaveCount(0)
  await openAssignment(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '점검 시작' }).click()
  await expect(page.getByText(/‘점검중’\(으\)로 변경/)).toBeVisible()

  // 검수하지 않고 완료하려 하면 서버·화면이 막는다
  await dialog.getByRole('button', { name: '점검 완료' }).click()
  await expect(page.getByText(`미검토 이미지가 ${COUNT}장 남아 있습니다.`)).toBeVisible()

  // 승인 3, 반려 2 (단축키 A / R). 하나 저장될 때마다 진행 수가 오른다.
  const reviewTab = dialog.getByRole('tab', { name: /이미지 검수/ })
  await reviewTab.click()
  await expect(reviewTab).toContainText(`(0/${COUNT})`)
  const keys = ['a', 'a', 'r', 'a', 'r']
  for (const [i, key] of keys.entries()) {
    await page.keyboard.press(key)
    await expect(reviewTab).toContainText(`(${i + 1}/${COUNT})`)
  }

  // ── QA: 점검 완료 ──
  await dialog.getByRole('button', { name: '점검 완료' }).click()
  await expect(page.getByText(/‘점검완료’\(으\)로 변경/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // ── QA: 점검 이력에 방금 한 검수 5건(승인 3, 반려 2)이 남아 있다 ──
  await page.getByRole('link', { name: '점검 이력' }).click()
  await expect(page.getByRole('heading', { name: '점검 이력' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^승인\s*3$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^반려\s*2$/ })).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(TITLE) })).toHaveCount(COUNT)
  await logout(page)

  // ── 관리자: 확인 완료 ──
  await login(page, 'admin@example.com')
  await openAssignment(page)
  await dialog.getByRole('button', { name: '확인 완료' }).click()
  await expect(page.getByText(/‘확인완료’\(으\)로 변경/)).toBeVisible()
  // 개요: 검수 결과가 그대로 남아 있고, 더 이상 진행할 단계 버튼이 없다
  await dialog.getByRole('tab', { name: '개요' }).click()
  await expect(dialog).toContainText(`${COUNT}/${COUNT} (100%)`)
  await expect(dialog.getByRole('button', { name: /점검 시작|점검 완료|확인 완료/ })).toHaveCount(0)
})
