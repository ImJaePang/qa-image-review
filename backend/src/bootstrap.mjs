// 공개(데모 아님) 서버의 첫 시작 처리: 시드의 데모 계정이 알려진 비밀번호(1234)로 남아 있지 않게 한다.
//  - 아직 1234인 관리자 계정 → ADMIN_PASSWORD로 비밀번호 교체 (ADMIN_EMAIL이 있으면 이메일도). 값이 없거나 약하면 시작을 거부한다.
//  - 아직 1234인 나머지 데모 계정(qa1~qa3) → 비활성화하고 비밀번호를 무작위로 바꾼다 (다시 켜도 1234로 들어올 수 없게).
// '아직 1234인 계정'만 대상으로 하므로 여러 번 실행해도 안전하다: 한 번 바꾼 뒤에는 아무것도 하지 않고, 관리자가 나중에 바꾼 비밀번호를 덮어쓰지 않는다.
import { randomBytes } from 'node:crypto'
import { txWith } from './tx.mjs'

export const DEMO_PASSWORD = '1234'
export const MIN_ADMIN_PASSWORD = 12

/** 관리자 초기 비밀번호 검사. 문제가 있으면 안내 문구, 없으면 null */
export function checkAdminPassword(password, email) {
  if (!password) return 'ADMIN_PASSWORD가 설정되어 있지 않습니다.'
  if (password.length < MIN_ADMIN_PASSWORD) return `ADMIN_PASSWORD는 ${MIN_ADMIN_PASSWORD}자 이상이어야 합니다.`
  if (password === DEMO_PASSWORD || (email && password.toLowerCase() === email.toLowerCase())) return 'ADMIN_PASSWORD가 너무 쉽습니다.'
  return null
}

const history = (db, userId, action, detail) =>
  db.query('INSERT INTO user_history (user_id, action, detail) VALUES ($1, $2, $3)', [userId, action, JSON.stringify(detail)])

/**
 * @returns {{ adminReset: boolean, disabled: string[] }} 이번에 바꾼 것 (비밀번호 값은 돌려주지 않는다)
 * @throws 관리자가 아직 1234인데 ADMIN_PASSWORD가 없거나 약할 때 (서버를 띄우지 않기 위해)
 */
export async function bootstrapAdmin(pool, { adminEmail, adminPassword } = {}) {
  return txWith(pool, async (db) => {
    const { rows: demo } = await db.query(`SELECT id, email, role FROM users WHERE password_hash = crypt($1, password_hash) ORDER BY id`, [DEMO_PASSWORD])
    const result = { adminReset: false, disabled: [] }
    const admin = demo.find((u) => u.role === 'admin')

    if (admin) {
      const email = adminEmail || admin.email
      const problem = checkAdminPassword(adminPassword, email)
      if (problem) {
        throw new Error(`공개 모드(DEMO_MODE=false)인데 관리자 비밀번호가 데모 값(1234)입니다. ${problem} .env에 길고 무작위인 ADMIN_PASSWORD를 설정하세요 (docs/deploy.md).`)
      }
      await db.query(`UPDATE users SET password_hash = crypt($2, gen_salt('bf')), email = $3, must_change_password = false WHERE id = $1`, [admin.id, adminPassword, email])
      await history(db, admin.id, 'PASSWORD_RESET', { via: 'BOOTSTRAP' })
      result.adminReset = true
    }

    for (const u of demo.filter((x) => x.id !== admin?.id)) {
      await db.query(`UPDATE users SET password_hash = crypt($2, gen_salt('bf')), status = 'DISABLED' WHERE id = $1`, [u.id, randomBytes(24).toString('hex')])
      await history(db, u.id, 'DISABLE', { via: 'BOOTSTRAP' })
      result.disabled.push(u.email)
    }
    return result
  })
}
