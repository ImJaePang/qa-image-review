// 워커 시작 시 정리 (단일 워커 잠금을 잡은 뒤에만 호출할 것: 다른 워커가 처리 중인 건을 건드리면 안 된다)
//  1) PROCESSING에 멈춘 이미지를 PENDING으로 되돌린다 (워커가 처리 중에 죽은 경우)
//  2) 처리중(processing) 폴더에 있는데 DB에 행이 없는 파일(고아)을 감시 폴더로 되돌려 다음 스캔에서 다시 수신한다
//     (수신 중 파일 이동 직후, COMMIT 전에 프로세스가 죽은 경우)
// 워커가 하나뿐이고 시작 시점이라 수신 도중인 파일은 없으므로, 행이 없으면 확실히 고아다.
import { lstat, readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { resolveFolderConfig } from './folder-config.mjs'
import { moveFile } from './fsutil.mjs'
import { recoverStuck } from './process.mjs'

const exists = (p) => lstat(p).then(() => true, () => false)

/** 감시 폴더에 같은 이름이 있으면 덮어쓰지 않고 -2, -3 ... 을 붙인다 */
async function freeName(dir, name) {
  const ext = extname(name)
  const stem = basename(name, ext)
  let candidate = name
  for (let n = 2; await exists(join(dir, candidate)); n++) candidate = `${stem}-${n}${ext}`
  return candidate
}

/** @returns {{ resetToPending: number, orphans: string[], errors: string[] }} */
export async function recoverOnStart({ pool, root }) {
  const result = { resetToPending: await recoverStuck(pool), orphans: [], errors: [] }

  const { rows } = await pool.query(`SELECT id, name, config FROM integrations WHERE kind = 'FOLDER' ORDER BY id`)
  for (const integ of rows) {
    try {
      const cfg = resolveFolderConfig(integ.config, root)
      const names = []
      for (const name of await readdir(cfg.processingDir).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))) {
        const st = await lstat(join(cfg.processingDir, name))
        if (st.isFile()) names.push(name)
      }
      if (!names.length) continue

      // 파일명 = image_key + 확장자. 한 번의 쿼리로 DB에 있는 키를 모두 확인한다 (수천 장이어도 쿼리 1회)
      const keyOf = (name) => basename(name, extname(name))
      const known = new Set(
        (await pool.query('SELECT image_key FROM images WHERE image_key = ANY($1::text[])', [names.map(keyOf)])).rows.map((r) => r.image_key),
      )
      for (const name of names.filter((n) => !known.has(keyOf(n)))) {
        const target = await freeName(cfg.watchDir, name)
        await moveFile(join(cfg.processingDir, name), join(cfg.watchDir, target))
        result.orphans.push(`${integ.name}: ${name}${target === name ? '' : ` → ${target}`}`)
      }
    } catch (err) {
      // 한 연계의 폴더/설정 문제가 다른 연계 정리를 막지 않게 한다
      result.errors.push(`[${integ.name}] ${err.message}`)
    }
  }
  return result
}
