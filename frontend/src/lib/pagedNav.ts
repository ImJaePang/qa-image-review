// 쪽으로 나뉜 목록을 크게 보기에서 한 장씩 넘길 때의 이동 규칙 (화면과 분리해 단위 테스트한다).

export interface PagedPos {
  page: number
  /** 그 쪽 안의 위치(0부터) */
  idx: number
}

/** 다음 위치. 같은 쪽이면 idx, 쪽을 넘기면 page와 'first'/'last'(새 쪽의 처음/끝), 끝이면 null */
export type PagedStep = { page: number; idx: number } | { page: number; edge: 'first' | 'last' } | null

/** 전체 목록 안의 위치(0부터) */
export const globalIndex = (pos: PagedPos, pageSize: number) => (pos.page - 1) * pageSize + pos.idx

export function stepPaged(pos: PagedPos, dir: 1 | -1, rowsOnPage: number, total: number, pageSize: number): PagedStep {
  const target = pos.idx + dir
  if (target >= 0 && target < rowsOnPage) return { page: pos.page, idx: target }
  const g = globalIndex(pos, pageSize) + dir
  if (g < 0 || g >= total) return null
  return { page: pos.page + dir, edge: dir === 1 ? 'first' : 'last' }
}
