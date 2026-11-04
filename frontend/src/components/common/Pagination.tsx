import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PAGE_SIZE_OPTIONS, pageCount } from '@/lib/paging'

/** 목록 공통 하단 바: 좌측 = 총 건수 + 페이지 크기 선택, 우측 = 이전/다음. 크기를 바꾸면 1쪽으로 돌아가는 것은 부모가 처리한다. */
export function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number
  page: number
  pageSize: number
  onPage: (p: number) => void
  onPageSize: (s: number) => void
}) {
  const pages = pageCount(total, pageSize)
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>총 {total}건</span>
        <Select
          items={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: `${n}개씩` }))}
          value={String(pageSize)}
          onValueChange={(v) => v && onPageSize(Number(v))}
        >
          <SelectTrigger size="sm" className="w-24" aria-label="페이지당 건수">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}개씩
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="이전 페이지">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="tabular-nums">
          {page} / {pages}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="다음 페이지">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
