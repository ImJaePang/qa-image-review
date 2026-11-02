// 워커의 한 주기: (주기가 된 연계마다) 폴더 스캔 → 대기 이미지를 최대 maxPerCycle장 처리.
// 타이머/프로세스와 분리해 두어 테스트에서 직접 호출할 수 있다. 설정(연계 목록)은 매 주기 DB에서 읽는다.
import { resolveFolderConfig } from './folder-config.mjs'
import { processOne } from './process.mjs'
import { scanOnce } from './scan.mjs'

/**
 * @param ctx { pool, adapter, root, filesDir, ruleName?, state, now?, maxPerCycle?, log? }
 *   state: 주기 사이에 유지되는 { seen: Map<integrationId, Map>, lastScan: Map<integrationId, ms> }
 */
export async function runCycle(ctx) {
  const { pool, state, now = Date.now(), maxPerCycle = 20, log = () => {} } = ctx
  const summary = { scanned: 0, received: 0, failedAtScan: 0, done: 0, failed: 0, errors: [] }

  const { rows } = await pool.query(`SELECT id, name, config FROM integrations WHERE kind = 'FOLDER' AND enabled ORDER BY id`)
  for (const integ of rows) {
    try {
      const { scanIntervalSec } = resolveFolderConfig(integ.config, ctx.root)
      const last = state.lastScan.get(integ.id)
      if (last != null && now - last < scanIntervalSec * 1000) continue
      state.lastScan.set(integ.id, now)
      if (!state.seen.has(integ.id)) state.seen.set(integ.id, new Map())
      const r = await scanOnce({ pool, integration: integ, root: ctx.root, filesDir: ctx.filesDir, seen: state.seen.get(integ.id) })
      summary.scanned++
      summary.received += r.received
      summary.failedAtScan += r.failed
      if (r.found) log(`[${integ.name}] 수신 ${r.received}장, 검증 실패 ${r.failed}장`)
    } catch (err) {
      // 한 연계의 설정/폴더 문제가 다른 연계와 추론을 막지 않게 한다
      summary.errors.push(`[${integ.name}] ${err.message}`)
    }
  }

  for (let i = 0; i < maxPerCycle; i++) {
    const r = await processOne(ctx)
    if (r.status === 'IDLE') break
    if (r.status === 'DONE') summary.done++
    else {
      summary.failed++
      log(`[추론 실패] ${r.imageKey}: ${r.error}`)
    }
  }
  return summary
}
