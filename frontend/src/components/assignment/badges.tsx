import { Badge } from '@/components/ui/badge'
import { REASON_LABELS } from '@/lib/domain'
import type { AssignmentStatus, ReasonCode, ReviewStatus, Verdict } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_STYLE: Record<AssignmentStatus, string> = {
  배정: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  점검중: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  점검완료: 'bg-lime-100 text-lime-800 dark:bg-lime-900/50 dark:text-lime-200',
  확인완료: 'bg-primary text-primary-foreground',
}

export function StatusBadge({ status }: { status: AssignmentStatus }) {
  return <Badge className={cn('border-transparent', STATUS_STYLE[status])}>{status}</Badge>
}

const VERDICT_STYLE: Record<Verdict, string> = {
  정상: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  의심: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  불량: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge className={cn('border-transparent', VERDICT_STYLE[verdict])}>{verdict}</Badge>
}

const REVIEW_STYLE: Record<ReviewStatus, string> = {
  미검토: 'text-muted-foreground',
  승인: 'text-emerald-600 dark:text-emerald-400',
  반려: 'text-red-600 dark:text-red-400',
}
export function ReviewMark({ status }: { status: ReviewStatus }) {
  return <span className={cn('text-xs font-medium', REVIEW_STYLE[status])}>{status}</span>
}

export function ReasonBadge({ code }: { code: ReasonCode }) {
  return (
    <Badge variant="outline" className="font-mono text-[11px]" title={REASON_LABELS[code]}>
      {code}
    </Badge>
  )
}
