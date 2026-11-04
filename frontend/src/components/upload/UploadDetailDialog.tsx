import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/common/Pagination'
import { api, type UploadFileState } from '@/api'
import { fmtDateTime } from '@/lib/domain'
import { DEFAULT_PAGE_SIZE } from '@/lib/paging'
import { UPLOAD_STATE_LABEL, UPLOAD_STATES, fmtBytes, summarizeProgress } from '@/lib/upload'
import { cn } from '@/lib/utils'

const tone = (s: UploadFileState) => (s === 'DONE' ? 'default' : s === 'FAILED' || s === 'REJECTED' ? 'destructive' : 'secondary')

/** 업로드 한 건의 파일별 처리 현황 (업로드 이력의 "보기") */
export function UploadDetailDialog({ batchId, onClose }: { batchId: string | null; onClose: () => void }) {
  const [state, setState] = useState<UploadFileState | 'ALL'>('ALL')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const { data } = useQuery({
    queryKey: ['uploads', 'one', batchId, state, page, pageSize],
    queryFn: () => api.getUpload(batchId!, { state: state === 'ALL' ? undefined : state, page, pageSize }),
    enabled: !!batchId,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data && (q.state.data.batch.waiting || q.state.data.batch.processing) ? 5000 : false),
  })
  const b = data?.batch
  const chip = (value: UploadFileState | 'ALL', label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setState(value)
        setPage(1)
      }}
      className={cn('border-r px-3 py-1.5 text-sm last:border-r-0', state === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
    >
      {label}
    </button>
  )

  return (
    <Dialog open={!!batchId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>업로드 상세{b ? ` — ${fmtDateTime(b.createdAt)}` : ''}</DialogTitle>
          <DialogDescription>
            {b ? `${b.createdByName} · ${b.uploaded.toLocaleString('ko-KR')} / ${b.expectedCount.toLocaleString('ko-KR')}장 올림 · ${summarizeProgress(b)}` : '불러오는 중…'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex overflow-hidden rounded-lg border self-start" role="radiogroup" aria-label="처리 상태">
          {chip('ALL', '전체')}
          {UPLOAD_STATES.map((s) => chip(s, UPLOAD_STATE_LABEL[s]))}
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>파일</TableHead>
                <TableHead className="w-24 text-right">크기</TableHead>
                <TableHead className="w-28">상태</TableHead>
                <TableHead>사유</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    불러오는 중…
                  </TableCell>
                </TableRow>
              )}
              {data?.files.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    해당하는 파일이 없습니다.
                  </TableCell>
                </TableRow>
              )}
              {data?.files.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="max-w-64 truncate font-medium" title={f.name}>
                    {f.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{f.size ? fmtBytes(f.size) : '-'}</TableCell>
                  <TableCell>
                    <Badge variant={tone(f.state)}>{UPLOAD_STATE_LABEL[f.state]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{f.reason ?? (f.imageKey ? f.imageKey : '-')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Pagination
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n)
            setPage(1)
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
