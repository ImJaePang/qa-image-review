// 워커 단일 실행 보장: PostgreSQL advisory lock (세션 잠금).
//  - 워커가 시작할 때 잠금을 잡고, 이미 다른 워커가 잡고 있으면 얻지 못한다.
//  - 잠금은 DB 연결에 묶여 있어서 프로세스가 죽거나 연결이 끊기면 DB가 자동으로 푼다 (잠금 파일처럼 찌꺼기가 남지 않음).
//  - 잠금을 쥔 연결은 풀에 돌려주지 않고 워커가 끝날 때까지 들고 있는다.
//  - 연결이 끊겨 잠금을 잃었다면 다른 워커가 시작했을 수 있으므로 onLost로 알려 워커가 멈추게 한다.
export const WORKER_LOCK_NAME = 'qa-review:ingest-worker'

/** @returns {Promise<{acquired: boolean, release: () => Promise<void>}>} */
export async function acquireWorkerLock(pool, { onLost = () => {} } = {}) {
  const client = await pool.connect()
  let held = false
  let finished = false
  const done = (destroy) => {
    if (finished) return
    finished = true
    client.removeListener('error', lost)
    client.release(destroy) // true면 연결 자체를 닫는다
  }
  const lost = (err) => {
    if (!held) return
    held = false
    done(true)
    onLost(err)
  }

  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [WORKER_LOCK_NAME])
    if (!rows[0].ok) {
      done(false)
      return { acquired: false, release: async () => {} }
    }
  } catch (err) {
    done(true)
    throw err
  }

  held = true
  client.on('error', lost) // 유휴 연결이 서버 쪽에서 끊긴 경우
  client.once('end', () => lost(new Error('DB 연결이 닫힘')))
  return {
    acquired: true,
    release: async () => {
      if (!held) return
      held = false
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [WORKER_LOCK_NAME])
      } finally {
        done(false)
      }
    },
  }
}
