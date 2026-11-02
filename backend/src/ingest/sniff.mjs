// 파일 앞부분(매직바이트)으로 이미지인지 확인한다. 확장자는 믿지 않는다.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SVG_RE = /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i

/** @param buf 파일 앞 1KB 이상  @returns 'png' | 'jpeg' | 'webp' | 'svg' | null */
export function detectImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG)) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (SVG_RE.test(buf.toString('utf8', 0, 1024).replace(/^﻿/, ''))) return 'svg'
  return null
}
