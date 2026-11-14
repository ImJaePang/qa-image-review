// 테스트 파일에서 가장 먼저 import: 빌드된 화면 대신 쓸 작은 폴더를 FRONTEND_DIST로 지정한다 (설정은 앱을 불러올 때 한 번 읽는다)
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dist = mkdtempSync(join(tmpdir(), 'qa-dist-'))
mkdirSync(join(dist, 'assets'))
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>spa</title>')
writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)')
process.env.FRONTEND_DIST = dist
