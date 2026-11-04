import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/api'
import { fmtDate, fmtDateTime } from '@/lib/domain'
import { ASSIGNMENT_STATUSES, type Assignment, type AssignmentStatus } from '@/lib/types'
import { useCan, useCurrentUser } from '@/stores/auth'
import { cn } from '@/lib/utils'
import { StatusBadge } from './badges'
import { ImageReviewPanel } from './ImageReviewPanel'

function Stepper({ status }: { status: AssignmentStatus }) {
  const cur = ASSIGNMENT_STATUSES.indexOf(status)
  return (
    <ol className="flex items-center gap-1 text-xs">
      {ASSIGNMENT_STATUSES.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-1',
              i < cur && 'bg-primary/15 text-primary',
              i === cur && 'bg-primary font-semibold text-primary-foreground',
              i > cur && 'bg-muted text-muted-foreground',
            )}
          >
            {i < cur && <Check className="size-3" />}
            {s}
          </span>
          {i < ASSIGNMENT_STATUSES.length - 1 && <ChevronRight className="size-3 text-muted-foreground" />}
        </li>
      ))}
    </ol>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  )
}

export function AssignmentDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: a, isError, error } = useQuery({
    queryKey: ['assignments', 'detail', id],
    queryFn: () => api.getAssignment(id!),
    enabled: !!id,
  })
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[88vh] max-w-[calc(100%-2rem)] flex-col gap-3 sm:max-w-6xl">
        {a ? (
          <Body a={a} />
        ) : (
          <>
            <DialogTitle>배정 상세</DialogTitle>
            <DialogDescription className={isError ? 'text-destructive' : undefined}>
              {isError ? (error as Error).message : '불러오는 중…'}
            </DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Body({ a }: { a: Assignment }) {
  const qc = useQueryClient()
  const me = useCurrentUser()
  const [tab, setTab] = useState('overview')
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const note = noteDraft ?? a.inspectionNote

  const isAdmin = useCan('assignment.manage') // 배정 관리 권한자 (남의 배정도 처리, 확인 완료)
  const isAssignee = me?.id === a.assigneeId
  const reviewed = a.counts.reviewed
  const total = a.counts.total

  const refresh = () => qc.invalidateQueries({ queryKey: ['assignments'] })

  const setStatus = useMutation({
    mutationFn: (v: { status: AssignmentStatus }) => api.setStatus(a.id, v.status),
    onSuccess: (_d, v) => {
      toast.success(`상태가 ‘${v.status}’(으)로 변경되었습니다.`)
      refresh()
    },
    onError: (e: Error) => {
      toast.error(e.message)
      refresh()
    },
  })
  const saveNote = useMutation({
    mutationFn: () => api.saveNote(a.id, note),
    onSuccess: () => {
      toast.success('점검 내용을 저장했습니다.')
      setNoteDraft(null)
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // 상태별 다음 단계 액션
  const next = (() => {
    switch (a.status) {
      case '배정':
        return isAssignee || isAdmin ? { label: '점검 시작', status: '점검중' as const } : null
      case '점검중':
        return isAssignee || isAdmin ? { label: '점검 완료', status: '점검완료' as const } : null
      case '점검완료':
        return isAdmin ? { label: '확인 완료', status: '확인완료' as const } : null
      default:
        return null
    }
  })()

  const onNext = () => {
    if (!next) return
    if (next.status === '점검완료' && reviewed < total) {
      toast.error(`미검토 이미지가 ${total - reviewed}장 남아 있습니다.`)
      setTab('review')
      return
    }
    setStatus.mutate(next)
  }

  const canReview = a.status === '점검중' && (isAssignee || isAdmin)
  const counts = a.counts

  return (
    <>
      <DialogHeader className="gap-2">
        <div className="flex items-center gap-3 pr-8">
          <DialogTitle className="text-lg">{a.title}</DialogTitle>
          <StatusBadge status={a.status} />
          <span className="font-mono text-xs text-muted-foreground">{a.id}</span>
          {next && (
            <Button size="sm" className="ml-auto" onClick={onNext} disabled={setStatus.isPending}>
              {next.label}
            </Button>
          )}
        </div>
        <DialogDescription className="sr-only">배정 상세 정보와 이미지 검수</DialogDescription>
        <Stepper status={a.status} />
      </DialogHeader>

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="overview">개요</TabsTrigger>
          <TabsTrigger value="review">
            이미지 검수 ({reviewed}/{total})
          </TabsTrigger>
          <TabsTrigger value="note">점검 내용 · 이력</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="overflow-auto">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Field label="담당자">{a.assigneeName}</Field>
            <Field label="배정자">{a.createdBy}</Field>
            <Field label="배정일">{fmtDate(a.createdAt)}</Field>
            <Field label="마감일">{a.dueDate}</Field>
            <Field label="이미지 수">{total}장</Field>
            <Field label="AI 판정 분포">
              정상 {counts.normal} · 의심 {counts.suspect} · 불량 {counts.defect}
            </Field>
            <Field label="검수 진행">
              {reviewed}/{total} ({total ? Math.round((reviewed / total) * 100) : 0}%)
            </Field>
            <Field label="모델 버전">{a.modelVersion ?? '-'}</Field>
          </dl>
          <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${total ? (reviewed / total) * 100 : 0}%` }} />
          </div>
        </TabsContent>

        <TabsContent value="review" className="min-h-0">
          <ImageReviewPanel assignment={a} canReview={canReview} />
        </TabsContent>

        <TabsContent value="note" className="grid min-h-0 grid-cols-1 gap-6 overflow-auto md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-semibold">점검 내용</p>
            <Textarea
              value={note}
              onChange={(e) => setNoteDraft(e.target.value)}
              disabled={!(isAssignee || isAdmin)}
              placeholder="전체 점검 의견을 입력하세요."
              className="min-h-48"
            />
            <Button size="sm" disabled={noteDraft === null || saveNote.isPending} onClick={() => saveNote.mutate()}>
              저장
            </Button>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">처리 이력</p>
            <ul className="space-y-2 border-l pl-4">
              {[...a.history].reverse().map((h, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
                  <p>{h.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.actor} · {fmtDateTime(h.at)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>
      </Tabs>
    </>
  )
}
