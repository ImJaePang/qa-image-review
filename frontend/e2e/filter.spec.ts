// 검수 필터·정렬(③)과 신규 배정 옵션(④): 정상 표본·검수 순서로 배정하고, 검수 화면에서 결과 칩·판정·정렬로 거른다.
// 테스트 DB 픽스처(미배정): 정상 6(0.9↑) / 의심 3(0.8 0.7 0.6) / 불량 3(0.4 0.3 0.2)
import { expect, test } from '@playwright/test'
import { freeImages } from './helpers'

const TITLE = '필터·정렬 시험 배정'

test('정상 표본 + 경계 순서로 배정하고, 검수 화면에서 필터·정렬한다', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('이메일').fill('admin@example.com')
  await page.getByLabel('비밀번호').fill('1234')
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL('**/review/assignments')
  await freeImages(page)
  await page.reload()

  // ── 신규 배정: 정상을 켜면 표본 비율이 나오고, 요약이 계산된다 ──
  await page.getByRole('button', { name: /신규 배정/ }).first().click()
  const modal = page.getByRole('dialog')
  await modal.locator('#t').fill(TITLE)
  await modal.getByRole('combobox').first().click()
  await page.getByRole('option', { name: '김검수' }).click()
  await modal.locator('#d').fill('2030-01-31')
  await expect(modal.getByTestId('normal-percent')).toHaveCount(0) // 정상을 켜기 전에는 표본 입력이 없다
  await modal.getByRole('button', { name: /^정상/ }).click()
  await expect(modal.getByTestId('normal-percent')).toHaveText('5%')
  // 정상 6장의 5%는 0.3장이지만 후보가 있으면 최소 1장 → 1 + 의심·불량 6 = 7장
  await expect(modal.getByTestId('assign-summary')).toContainText('배정 대상 7장')
  await expect(modal.getByTestId('assign-summary')).toContainText('정상 표본 1 + 의심·불량 6')
  await modal.getByRole('combobox', { name: '검수 순서' }).click()
  await page.getByRole('option', { name: '경계에 가까운 순' }).click()
  await modal.locator('#c').fill('7')
  await modal.getByRole('button', { name: '배정하기' }).click()
  await expect(page.getByText('배정 완료 (7장')).toBeVisible()

  // ── 검수 화면: 결과 칩 건수, 판정 필터, 정렬 ──
  await page.getByRole('row', { name: new RegExp(TITLE) }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '점검 시작' }).click()
  await expect(page.getByText(/‘점검중’\(으\)로 변경/)).toBeVisible()
  await dialog.getByRole('tab', { name: /이미지 검수/ }).click()

  const chip = (name: string) => dialog.getByRole('button', { name: new RegExp(`^${name}\\s*\\d+$`) })
  await expect(chip('전체')).toContainText('7')
  await expect(chip('미검토')).toContainText('7')
  await expect(dialog.getByText('승인 문제없이 사용할 수 있음')).toBeVisible() // 승인/반려 안내

  // 판정을 '불량'으로: 3장
  await dialog.getByRole('combobox', { name: 'AI 판정' }).click()
  await page.getByRole('option', { name: '불량' }).click()
  await expect(chip('전체')).toContainText('3')

  // 불량 중 첫 이미지를 승인하면 미검토가 2장으로 (승인 1)
  await page.keyboard.press('a')
  await expect(chip('승인')).toContainText('1')
  await expect(chip('미검토')).toContainText('2')

  // 미검토 + 점수 높은 순: 남은 불량 0.30, 0.20 중 0.30이 맨 위
  await chip('미검토').click()
  await dialog.getByRole('combobox', { name: '정렬' }).click()
  await page.getByRole('option', { name: '점수 높은 순' }).click()
  const rows = dialog.locator('ul.relative > li')
  await expect(rows.first()).toContainText('0.30')
  await expect(rows).toHaveCount(2)

  // 조건에 맞는 이미지가 없으면 안내와 '필터 지우기'
  await dialog.getByRole('combobox', { name: 'AI 판정' }).click()
  await page.getByRole('option', { name: '의심' }).click()
  await chip('승인').click()
  await expect(dialog.getByText('조건에 맞는 이미지가 없습니다.').first()).toBeVisible()
  await dialog.getByRole('button', { name: '필터 지우기' }).click()
  await expect(chip('전체')).toContainText('7')
  await expect(rows.first()).toBeVisible()
})
