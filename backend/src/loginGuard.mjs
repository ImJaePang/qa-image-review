// 로그인 시도 횟수 제한 (설계 9장). 비밀번호를 받는 모든 곳(로그인, 만료 해제 요청)이 같은 횟수를 공유한다.
//  - 이메일 기준: 같은 이메일로 limit 번 실패하면 lockSec 동안 잠근다. 없는 이메일도 똑같이 센다(존재 여부 노출 방지).
//  - 접속 주소 기준: 한 주소에서 여러 이메일을 돌려 가며 시도하는 것을 막는다. 사무실처럼 주소를 같이 쓰는 곳을 고려해 한도를 더 높게 둔다.
//  - 잠금 중에는 비밀번호를 검사하지 않고(맞는 비밀번호도 거부) 실패로 세지도 않는다 → 잠금이 계속 연장되지 않는다.
//  - 성공하면 그 이메일의 실패 횟수를 지운다.
import { config } from './config.mjs'
import { httpError } from './errors.mjs'

const lim = config.loginLimit
const norm = (email) => String(email).trim().toLowerCase()

/** 지금 잠겨 있으면 429를 던진다. 비밀번호 검사 전에 호출한다. */
export async function assertNotLocked(db, email, ip) {
  const { rows } = await db.query(
    `SELECT max(ceil(extract(epoch FROM locked_until - now())))::int AS wait
       FROM login_failures
      WHERE locked_until > now() AND ((scope = 'EMAIL' AND key = $1) OR (scope = 'IP' AND key = $2))`,
    [norm(email), ip ?? ''],
  )
  const wait = rows[0]?.wait
  if (wait > 0) {
    const err = httpError(429, `로그인 시도가 너무 많습니다. ${Math.ceil(wait / 60)}분 후에 다시 시도해 주세요.`, 'LOCKED')
    err.retryAfter = wait
    throw err
  }
}

/** 실패를 센다. 한도에 닿으면 잠금 시각을 정한다. 한 문장으로 처리해 동시에 들어와도 어긋나지 않는다. */
export async function recordFailure(db, email, ip) {
  const upsert = (scope, key, max) =>
    db.query(
      `INSERT INTO login_failures AS t (scope, key, failures, window_started_at, last_failed_at, locked_until)
       VALUES ($1, $2, 1, now(), now(), CASE WHEN 1 >= $3 THEN now() + make_interval(secs => $5) END)
       ON CONFLICT (scope, key) DO UPDATE SET
         failures = CASE WHEN t.window_started_at < now() - make_interval(secs => $4) OR t.locked_until <= now() THEN 1 ELSE t.failures + 1 END,
         window_started_at = CASE WHEN t.window_started_at < now() - make_interval(secs => $4) OR t.locked_until <= now() THEN now() ELSE t.window_started_at END,
         last_failed_at = now(),
         locked_until = CASE
           WHEN (CASE WHEN t.window_started_at < now() - make_interval(secs => $4) OR t.locked_until <= now() THEN 1 ELSE t.failures + 1 END) >= $3
           THEN now() + make_interval(secs => $5) END`,
      [scope, key, max, lim.windowSec, lim.lockSec],
    )
  await upsert('EMAIL', norm(email), lim.maxFailures)
  if (ip) await upsert('IP', ip, lim.ipMaxFailures)
}

/** 로그인에 성공하면 그 이메일의 실패 기록을 지운다 (주소 기준 기록은 구간이 지나야 풀린다). */
export async function clearFailures(db, email) {
  await db.query(`DELETE FROM login_failures WHERE scope = 'EMAIL' AND key = $1`, [norm(email)])
}

/** 오래된 기록 정리 (구간·잠금이 모두 지난 것). 서버가 켜질 때와 가끔 호출한다. */
export async function purgeOldFailures(db) {
  await db.query(
    `DELETE FROM login_failures WHERE last_failed_at < now() - make_interval(secs => $1) AND (locked_until IS NULL OR locked_until < now())`,
    [Math.max(lim.windowSec, lim.lockSec) * 2],
  )
}
