import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type Integration } from '@/api'
import { fmtDateTime } from '@/lib/domain'

/** 연계의 실패 건 목록(최근 50건)과 재시도 */
export function FailedImagesDialog({ integration, onClose }: { integration: Integration | null; onClose: () => void }) {
  const qc = useQueryClient()
  const id = integration?.id
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['integrations', id, 'failed'],
    queryFn: () => api.integrationFailed(id!),
    enabled: !!id,
  })

  const retry = useMutation({
    mutationFn: () => api.retryIntegration(id!),
    onSuccess: (r) => {
      if (r.retried) toast.success(`${r.retried}건을 다시 처리하도록 되돌렸습니다`)
      if (r.skipped.length) toast.warning(`${r.skipped.length}건은 건너뛰었습니다 (${r.skipped[0].reason})`)
      if (!r.retried && !r.skipped.length) toast.info('다시 처리할 실패 건이 없습니다')
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={!!integration} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>실패 건 · {integration?.name}</DialogTitle>
          <DialogDescription>
            최근 50건만 보입니다. 다시 처리하면 파일이 실패 폴더에서 처리 중 폴더로 돌아가고, 워커가 새 수신 배치로 판정합니다.
            이미지가 아니거나 크기 상한을 넘어서 실패한 건은 설정을 고치지 않으면 다시 실패합니다.
          </DialogDescription>
        </DialogHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>파일</TableHead>
              <TableHead>사유</TableHead>
              <TableHead className="w-36">수신</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                  실패한 건이 없습니다.
                </TableCell>
              </TableRow>
            )}
            {items.map((f) => (
              <TableRow key={f.imageKey}>
                <TableCell>
                  <p className="text-sm">{f.sourceName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{f.imageKey}</p>
                </TableCell>
                <TableCell className="whitespace-normal text-xs text-red-600 dark:text-red-400">{f.error ?? '-'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDateTime(f.receivedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button disabled={items.length === 0 || retry.isPending} onClick={() => retry.mutate()}>
            실패 건 다시 처리
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
