// 목록 API 공통 페이징 규칙 (프론트 frontend/src/lib/paging.ts와 같은 값): 기본 20건, 화면에서 20/50/100/1000 중 선택.
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 1000

export const pagingQuery = {
  page: { type: 'integer', minimum: 1, default: 1 },
  pageSize: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
}
