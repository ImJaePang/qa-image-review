// 목록(게시판) 공통 페이징 규칙: 기본 20건, 사용자가 20/50/100/1000 중에서 고른다. 서버 상한(backend/src/paging.mjs)과 같은 값.
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 1000] as const
export const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0]

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize))

/** 번호 버튼에 보여 줄 창 크기 (현재 페이지가 속한 10개씩 묶음) */
export const PAGE_WINDOW = 10

/** 현재 페이지가 속한 묶음의 번호들. 예) 15페이지 중 3쪽 → 1~10, 12쪽 → 11~15 */
export function pageWindow(page: number, pages: number, size = PAGE_WINDOW): number[] {
  const start = Math.floor((Math.max(1, page) - 1) / size) * size + 1
  const end = Math.min(pages, start + size - 1)
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i)
}
