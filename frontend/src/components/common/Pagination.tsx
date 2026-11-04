import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PAGE_SIZE_OPTIONS, pageCount, pageWindow } from '@/lib/paging'

/**
 * 목록 공통 하단 바 (세 칸): 좌측 = 총 건수 + 페이지 크기 선택, 가운데 = 번호 이동, 우측 = 현재/전체 쪽수.
 * 번호는 현재 페이지가 속한 10개 묶음만 보이고, « » 로 처음/끝, ‹ › 로 한 쪽씩 이동한다.
 * 크기를 바꾸면 1쪽으로 돌아가는 것은 부모가 처리한다.
 */
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
  const nav = (label: string, to: number, disabled: boolean, icon: React.ReactNode) => (
    <Button variant="outline" size="icon-sm" disabled={disabled} onClick={() => onPage(to)} aria-label={label}>
      {icon}
    </Button>
  )
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm text-muted-foreground">
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

      <nav className="flex items-center gap-1" aria-label="페이지 이동">
        {nav('첫 페이지', 1, page <= 1, <ChevronsLeft className="size-4" />)}
        {nav('이전 페이지', page - 1, page <= 1, <ChevronLeft className="size-4" />)}
        {pageWindow(page, pages).map((n) => (
          <Button key={n} variant={n === page ? 'default' : 'ghost'} size="icon-sm" className="tabular-nums" aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>
            {n}
          </Button>
        ))}
        {nav('다음 페이지', page + 1, page >= pages, <ChevronRight className="size-4" />)}
        {nav('마지막 페이지', pages, page >= pages, <ChevronsRight className="size-4" />)}
      </nav>

      <span className="justify-self-end tabular-nums">
        {page} / {pages} 쪽
      </span>
    </div>
  )
}
