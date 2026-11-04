// fetch 래퍼: 같은 출처(/api, Vite 프록시)로 호출하고 쿠키 세션을 사용한다.
// 에러 응답은 서버가 { message }로 준다.

export class ApiError extends Error {
  status: number
  /** 서버가 주는 선택적 코드 (예: 로그인 거절 사유 PENDING/EXPIRED/DISABLED) */
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let onUnauthorized: (() => void) | null = null
/** 세션이 만료되어 401을 받았을 때 호출할 핸들러(인증 스토어가 등록) */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // 로그인/가입 실패의 401은 세션 만료가 아니므로 제외
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized?.()
    throw new ApiError(res.status, data?.message ?? '요청에 실패했습니다.', data?.code)
  }
  return data as T
}

export const get = <T>(path: string) => request<T>('GET', path)
export const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {})
export const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body)
export const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body)
