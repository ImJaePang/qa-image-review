/** @param code 프론트가 분기할 때 쓰는 선택적 코드 (예: 계정 상태). 응답은 { message, code } */
export function httpError(statusCode, message, code) {
  const err = new Error(message)
  err.statusCode = statusCode
  if (code) err.appCode = code
  return err
}
