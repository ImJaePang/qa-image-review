// 이미지 확대 보기와 박스 호버 설명: 박스에 올리면 한글 원인 카드가 뜨고 목록과 함께 강조되며,
// Z로 확대 화면을 열어 확대·원본 크기·맞춤·승인까지 하고 Esc로 돌아온다.
import { expect, test, type Page } from '@playwright/test'

const TITLE = '확대 보기 시험 배정'

async function loginAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('이메일').fill('admin@example.com')
  await page.getByLabel('비밀번호').fill('1234')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL('**/review/assignments')
}

const percent = async (page: Page) => Number.parseInt((await page.getByTestId('zoom-percent').innerText()).replace('%', ''), 10)

test('박스 호버 카드와 확대 화면', async ({ page }) => {
  await loginAdmin(page)

  // 시험용 배정 1건(의심·불량 1장)을 만들어 점검을 시작한다
  await page.getByRole('button', { name: /신규 배정/ }).first().click()
  const modal = page.getByRole('dialog')
  await modal.locator('#t').fill(TITLE)
  await modal.getByRole('combobox').click()
  await page.getByRole('option', { name: '김검수' }).click()
  await modal.locator('#d').fill('2030-01-31')
  await modal.locator('#c').fill('1')
  await modal.getByRole('button', { name: '배정하기' }).click()
  await expect(page.getByText('배정 완료 (1장')).toBeVisible()
  await page.getByRole('row', { name: new RegExp(TITLE) }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '점검 시작' }).click()
  await expect(page.getByText(/‘점검중’\(으\)로 변경/)).toBeVisible()
  await dialog.getByRole('tab', { name: /이미지 검수/ }).click()

  // ── 박스 호버: 번호만 보이다가 올리면 카드, 오른쪽 목록도 함께 강조 ──
  const box = dialog.locator('[data-box="0"]')
  await expect(box).toBeVisible()
  await expect(box).toContainText('1')
  const tip = dialog.getByTestId('box-tip')
  await expect(tip).toHaveCSS('opacity', '0')
  await box.hover()
  await expect(tip).toHaveCSS('opacity', '1')
  await expect(tip).toContainText('질감 이상') // 한글 원인 이름
  await expect(tip).toContainText('TEXTURE_ANOMALY') // 코드는 작게
  await expect(tip).toContainText('표면 질감') // 설명 문장
  await expect(tip).toContainText('위치 100, 100 · 50×50 px')
  await expect(dialog.locator('[class*="bg-accent"]', { hasText: '질감 이상' })).toBeVisible() // 목록 강조
  await page.mouse.move(5, 5)
  await expect(tip).toHaveCSS('opacity', '0')

  // ── Z: 확대 화면 ──
  await page.keyboard.press('z')
  const stage = page.getByTestId('lightbox-stage')
  await expect(stage).toBeVisible()
  const fit = await percent(page)
  expect(fit).toBeGreaterThan(0)

  await page.getByRole('button', { name: '확대', exact: true }).click()
  expect(await percent(page)).toBeGreaterThan(fit)
  await page.getByRole('button', { name: /원본 크기/ }).click()
  expect(await percent(page)).toBe(100)
  await page.getByRole('button', { name: /^맞춤/ }).click()
  expect(await percent(page)).toBe(fit)

  // 휠로 확대
  const sb = (await stage.boundingBox())!
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await page.mouse.wheel(0, -300)
  await expect.poll(() => percent(page)).toBeGreaterThan(fit)

  // 확대 화면에서도 박스 호버 카드가 뜬다
  await page.getByRole('button', { name: /^맞춤/ }).click()
  await stage.locator('[data-box="0"]').hover()
  await expect(stage.getByTestId('box-tip')).toContainText('질감 이상')

  // 확대 화면에서 승인 (A)
  await page.mouse.move(sb.x + 5, sb.y + 5)
  await page.keyboard.press('a')
  await expect(page.getByText('미검토 이미지가 없습니다.')).toBeVisible() // 마지막 한 장이라 다음이 없다
  await expect(page.getByRole('dialog').last().getByText('승인', { exact: true }).first()).toBeVisible()

  // Esc로 확대 화면만 닫히고 상세 모달은 그대로
  await page.keyboard.press('Escape')
  await expect(stage).toBeHidden()
  await expect(dialog.first().getByRole('tab', { name: /이미지 검수 \(1\/1\)/ })).toBeVisible()
})
