// 메일 발송. 모드는 config.mail.mode: off(발송 안 함) / log(개발용: 서버 로그에 출력) / smtp(실제 발송).
//  - 호출하는 쪽은 mailEnabled()로 발송 여부를 먼저 정한다. off일 때 sendMail을 부르면 오류다.
//  - 발송 결과는 mail_log에 남기되 본문은 저장하지 않는다 (임시 비밀번호가 들어 있다).
import nodemailer from 'nodemailer'
import { config } from './config.mjs'
import { httpError } from './errors.mjs'

const { mail } = config
if (!['off', 'log', 'smtp'].includes(mail.mode)) throw new Error(`MAIL_MODE는 off/log/smtp 중 하나여야 합니다 (현재: ${mail.mode})`)
if (mail.mode === 'log' && config.isProd) throw new Error('운영(production)에서는 MAIL_MODE=log를 쓸 수 없습니다 (메일 본문이 로그에 남음)')
if (mail.mode === 'smtp' && !mail.smtp.host) throw new Error('MAIL_MODE=smtp 이면 SMTP_HOST가 필요합니다')

let transport
const getTransport = () => {
  transport ??= nodemailer.createTransport({
    host: mail.smtp.host,
    port: mail.smtp.port,
    secure: mail.smtp.secure,
    auth: mail.smtp.user ? { user: mail.smtp.user, pass: mail.smtp.pass } : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  })
  return transport
}

export const mailEnabled = () => mail.mode !== 'off'
export const maskEmail = (email) => email.replace(/^(.).*(@.*)$/, '$1***$2')

/** 메일을 보내고 mail_log에 결과를 남긴다. 실패하면 502를 던진다 (기록은 남는다). */
export async function sendMail(db, { kind, userId, to, subject, text, actorId }) {
  if (!mailEnabled()) throw new Error('메일 발송이 꺼져 있습니다 (MAIL_MODE=off)')
  const log = (status, error) =>
    db.query('INSERT INTO mail_log (kind, user_id, to_address, mode, status, error, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)', [kind, userId ?? null, to, mail.mode, status, error ?? null, actorId ?? null])
  try {
    if (mail.mode === 'log') {
      console.log(`[mail:log] to=${to} subject=${subject}\n${text}\n`)
    } else {
      await getTransport().sendMail({ from: mail.from, to, subject, text })
    }
  } catch (err) {
    await log('FAILED', String(err.message ?? err).slice(0, 300)).catch(() => undefined)
    throw httpError(502, '메일을 보내지 못했습니다. 메일 설정을 확인해 주세요.')
  }
  await log('SENT')
}

export const tempPasswordMail = (name, temp) => ({
  subject: '[QA 검수 시스템] 임시 비밀번호 안내',
  text: `${name}님, 안녕하세요.\n\n관리자가 비밀번호를 초기화했습니다.\n임시 비밀번호: ${temp}\n\n이 비밀번호로 로그인하면 새 비밀번호를 바로 정해야 합니다.\n본인이 요청하지 않았다면 관리자에게 알려 주세요.\n`,
})
