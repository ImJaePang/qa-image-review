import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FailedImagesDialog } from '@/components/integration/FailedImagesDialog'
import { IntegrationFormDialog } from '@/components/integration/IntegrationFormDialog'
import { api, type Integration } from '@/api'
import { fmtDateTime } from '@/lib/domain'
import { cn } from '@/lib/utils'
import { useCan } from '@/stores/auth'

function Count({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  return (
    <span className="text-sm">
      <span className="text-muted-foreground">{label} </span>
      <span
        className={cn(
          'font-semibold tabular-nums',
          tone === 'bad' && value > 0 && 'text-red-600 dark:text-red-400',
          tone === 'warn' && value > 0 && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {value.toLocaleString()}
      </span>
    </span>
  )
}

function IntegrationCard({ item, onEdit, onFailed }: { item: Integration; onEdit: () => void; onFailed: () => void }) {
  const qc = useQueryClient()
  const toggle = useMutation({
    mutationFn: () => api.updateIntegration(item.id, { enabled: !item.enabled }),
    onSuccess: (r) => {
      toast.success(r.enabled ? `${r.name}: 사용을 켰습니다` : `${r.name}: 사용을 껐습니다 (이미 받은 파일 처리는 계속됩니다)`)
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const c = item.config
  const { counts } = item

  return (
    <div className={cn('rounded-lg border bg-card p-4', !item.enabled && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('size-2.5 rounded-full', item.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
        <h3 className="text-base font-semibold">{item.name}</h3>
        <Badge variant="outline" className="font-mono">
          {item.kind}
        </Badge>
        <Badge className={cn('border-transparent', item.enabled ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>
          {item.enabled ? '사용 중' : '꺼짐'}
        </Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
            {item.enabled ? '끄기' : '켜기'}
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            수정
          </Button>
        </div>
      </div>

      <p className="mt-2 font-mono text-xs text-muted-foreground">
        감시 {c.watchDir}/ · {c.extensions.join(' ')} · {c.scanIntervalSec}초마다 · 상한 {c.maxFileMB}MB
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t pt-3">
        <Count label="대기" value={counts.pending} />
        <Count label="처리 중" value={counts.processing} />
        <Count label="완료" value={counts.done} />
        <Count label="실패" value={counts.failed} tone="bad" />
        <span className="text-xs text-muted-foreground">
          최근 수신 {item.lastReceivedAt ? fmtDateTime(item.lastReceivedAt) : '없음'}
        </span>
        {counts.failed > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto text-red-600 dark:text-red-400" onClick={onFailed}>
            실패 {counts.failed}건 보기 · 재시도
          </Button>
        )}
      </div>
    </div>
  )
}

export function IntegrationsPage() {
  const isAdmin = useCan('integration.manage')
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['integrations'],
    queryFn: api.listIntegrations,
    enabled: isAdmin,
    refetchInterval: 10_000, // 건수는 워커가 계속 바꾼다
  })
  const [editing, setEditing] = useState<Integration | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [failedOf, setFailedOf] = useState<Integration | null>(null)

  if (!isAdmin) return <p className="p-6 text-sm text-muted-foreground">이 화면을 쓸 권한이 없습니다.</p>

  const openForm = (item: Integration | null) => {
    setEditing(item)
    setFormOpen(true)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">연계 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            이미지를 받아 오는 곳을 설정합니다. 진행 현황 상세는 모니터링 메뉴에서 봅니다.
          </p>
        </div>
        <Button onClick={() => openForm(null)} disabled={!data}>
          <Plus /> 연계 추가
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
      {isError && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {data && data.items.length === 0 && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 연계가 없습니다. 워커를 처음 실행하면 기본 폴더 연계가 만들어집니다.
        </p>
      )}
      <div className="space-y-3">
        {data?.items.map((it) => (
          <IntegrationCard key={it.id} item={it} onEdit={() => openForm(it)} onFailed={() => setFailedOf(it)} />
        ))}
      </div>

      {data && (
        <IntegrationFormDialog open={formOpen} onOpenChange={setFormOpen} integration={editing} root={data.root} defaults={data.defaults} suggestBase={`source-${data.items.length + 1}`} />
      )}
      <FailedImagesDialog integration={failedOf} onClose={() => setFailedOf(null)} />
    </div>
  )
}
