import { describe, expect, test } from 'vitest'
import { describeRoleHistory, validateRoleForm } from './roles'

const ok = { isNew: true, code: 'auditor', label: '감사', description: '', sortOrder: '' }

describe('validateRoleForm', () => {
  test('정상 입력은 통과한다 (설명·순서는 비워도 된다)', () => {
    expect(validateRoleForm(ok)).toBeNull()
    expect(validateRoleForm({ ...ok, sortOrder: '40' })).toBeNull()
  })
  test('신규일 때만 코드 형식을 검사한다', () => {
    expect(validateRoleForm({ ...ok, code: 'Audit' })).toMatch(/코드/)
    expect(validateRoleForm({ ...ok, code: '1abc' })).toMatch(/코드/)
    expect(validateRoleForm({ ...ok, code: 'a' })).toMatch(/코드/)
    expect(validateRoleForm({ ...ok, isNew: false, code: 'Legacy-Code' })).toBeNull()
  })
  test('이름 필수·길이, 순서는 숫자', () => {
    expect(validateRoleForm({ ...ok, label: '  ' })).toMatch(/이름/)
    expect(validateRoleForm({ ...ok, label: 'a'.repeat(31) })).toMatch(/30자/)
    expect(validateRoleForm({ ...ok, sortOrder: 'x' })).toMatch(/순서/)
    expect(validateRoleForm({ ...ok, description: 'a'.repeat(301) })).toMatch(/300자/)
  })
})

describe('describeRoleHistory', () => {
  test('단순 동작', () => {
    expect(describeRoleHistory({ action: 'CREATE', detail: {} })).toEqual(['권한 만들기'])
    expect(describeRoleHistory({ action: 'DEACTIVATE', detail: {} })).toEqual(['사용 안 함으로 전환'])
    expect(describeRoleHistory({ action: 'ACTIVATE', detail: {} })).toEqual(['다시 사용'])
  })
  test('수정은 바뀐 항목마다 한 줄 (설명은 변경 사실만)', () => {
    const lines = describeRoleHistory({
      action: 'UPDATE',
      detail: { label: { from: '리서처', to: '연구원' }, description: { from: null, to: '긴 설명' }, signupSelectable: { from: false, to: true } },
    })
    expect(lines).toEqual(['이름: 리서처 → 연구원', '설명 변경', '가입 신청 가능: 불가 → 가능'])
  })
})
