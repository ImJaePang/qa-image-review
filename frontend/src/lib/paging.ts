// 목록(게시판) 공통 페이징 규칙: 기본 20건, 사용자가 20/50/100/1000 중에서 고른다. 서버 상한(backend/src/paging.mjs)과 같은 값.
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 1000] as const
export const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0]

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize))
