import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

/** 권한 목록과 이름 표시. 권한 종류는 DB(roles)가 정하므로 화면은 항상 이 목록에서 이름·선택지를 얻는다. */
export function useRoles() {
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: api.listRoles, staleTime: 60_000 })
  /** 코드 → 이름 (아직 못 불러왔거나 모르는 코드면 코드 그대로) */
  const roleLabel = (code: string | null | undefined) => (code ? (roles.find((r) => r.code === code)?.label ?? code) : '-')
  return { roles, roleLabel }
}
