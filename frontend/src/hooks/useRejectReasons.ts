import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

/** 반려 사유 선택지 (DB reject_reasons). 자주 바뀌지 않으므로 한 번 받아 두고 같이 쓴다 */
export function useRejectReasons() {
  return useQuery({ queryKey: ['reject-reasons'], queryFn: api.listRejectReasons, staleTime: 10 * 60_000 })
}
