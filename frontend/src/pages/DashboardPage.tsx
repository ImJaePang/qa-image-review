import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api } from '@/api'
import { STATUS_KO, VERDICT_KO } from '@/api/mappers'
import { barRatio, dayLabel, niceMax, percentLabel, percentOf, ticks } from '@/lib/dashboard'
import { cn } from '@/lib/utils'
import { useCan } from '@/stores/auth'

const VERDICT_KEYS = ['NORMAL', 'SUSPECT', 'DEFECT'] as const
// 판정 색은 앱 전체의 배지 색과 같다 (정상 초록 계열 / 의심 호박 / 불량 빨강). 수치와 이름을 함께 적어 색만으로 구분하지 않는다.
const VERDICT_BAR: Record<(typeof VERDICT_KEYS)[number], string> = {
  NORMAL: 'bg-emerald-500 dark:bg-emerald-400',
  SUSPECT: 'bg-amber-500 dark:bg-amber-400',
  DEFECT: 'bg-red-500 dark:bg-red-400',
}
const STATUS_KEYS = ['ASSIGNED', 'IN_REVIEW', 'REVIEWED', 'CONFIRMED'] as const

const nf = (n: number) => n.toLocaleString()

function Card({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  )
}

export function DashboardPage() {
  const canManage = useCan('assignment.manage')
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const { data: d, isLoading, isError, error } = useQuery({ queryKey: ['dashboard', tz], queryFn: () => api.dashboard(tz), refetchOnMount: 'always' })

  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  if (isError || !d) return <p className="text-sm text-destructive">{(error as Error)?.message ?? '불러오지 못했습니다.'}</p>

  const totalImages = VERDICT_KEYS.reduce((n, k) => n + d.images[k], 0)
  const open = d.mine.openAssignments
  const targets = d.unassignedTargets
  const targetTotal = targets ? targets.SUSPECT + targets.DEFECT : 0
  const rv = d.review
  const workScope = d.scope.work === 'mine' ? '내 것만' : '전체'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">대시보드</h1>
        <p className="text-sm text-muted-foreground">지금 해야 할 일과 현황을 한눈에 봅니다.</p>
      </div>

      {/* 지금 할 일 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="내 검수 대기">
          {open > 0 ? (
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-semibold tabular-nums">
                  {nf(d.mine.unreviewed)}
                  <span className="ml-1 text-base font-normal text-muted-foreground">장 남음</span>
                </p>
                <p className="text-xs text-muted-foreground">진행 중인 배정 {nf(open)}건</p>
              </div>
              <Link to="/review/my-assignments" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                내 배정 열기 <ArrowRight className="size-4" />
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">지금 맡은 검수가 없습니다.</p>
          )}
        </Card>

        {canManage && targets && (
          <Card title="아직 배정하지 않은 검수 대상" note="의심·불량 중 어느 배정에도 없는 이미지">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-semibold tabular-nums">
                  {nf(targetTotal)}
                  <span className="ml-1 text-base font-normal text-muted-foreground">장</span>
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  의심 {nf(targets.SUSPECT)} · 불량 {nf(targets.DEFECT)}
                </p>
              </div>
              {targetTotal > 0 ? (
                <Link to="/review/assignments" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  신규 배정하러 가기 <ArrowRight className="size-4" />
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">모두 배정됨</span>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* AI 판정 분포 */}
      <Card title="AI 판정 분포" note={`${d.scope.images === 'mine' ? '내게 배정된 이미지' : '수신·판정이 끝난 전체 이미지'} ${nf(totalImages)}장`}>
        {totalImages === 0 ? (
          <p className="text-sm text-muted-foreground">아직 판정된 이미지가 없습니다.</p>
        ) : (
          <>
            <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={VERDICT_KEYS.map((k) => `${VERDICT_KO[k]} ${d.images[k]}장`).join(', ')}>
              {VERDICT_KEYS.filter((k) => d.images[k] > 0).map((k) => (
                <div key={k} className={VERDICT_BAR[k]} style={{ flexGrow: d.images[k], flexBasis: 0 }} />
              ))}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-3">
              {VERDICT_KEYS.map((k) => (
                <div key={k}>
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={cn('size-2.5 rounded-sm', VERDICT_BAR[k])} /> {VERDICT_KO[k]}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {nf(d.images[k])}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">{percentOf(d.images[k], totalImages)}%</span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="배정 현황" note={workScope}>
          <dl className="grid grid-cols-4 gap-3">
            {STATUS_KEYS.map((s) => (
              <div key={s}>
                <dt className="text-xs text-muted-foreground">{STATUS_KO[s]}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{nf(d.assignments[s])}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="검수 진행" note={workScope}>
          {rv.total === 0 ? (
            <p className="text-sm text-muted-foreground">배정된 이미지가 없습니다.</p>
          ) : (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">{percentLabel(rv.reviewed, rv.total)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {nf(rv.reviewed)} / {nf(rv.total)}장 검수
                </span>
              </p>
              <div className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`승인 ${rv.approved}장, 반려 ${rv.rejected}장, 미검토 ${rv.total - rv.reviewed}장`}>
                {rv.approved > 0 && <div className="bg-primary" style={{ flexGrow: rv.approved, flexBasis: 0 }} />}
                {rv.rejected > 0 && <div className="bg-red-500 dark:bg-red-400" style={{ flexGrow: rv.rejected, flexBasis: 0 }} />}
                {rv.total - rv.reviewed > 0 && <div style={{ flexGrow: rv.total - rv.reviewed, flexBasis: 0 }} />}
              </div>
              <p className="mt-2 flex gap-4 text-xs tabular-nums text-muted-foreground">
                <span>
                  <span className="mr-1 inline-block size-2.5 rounded-sm bg-primary align-middle" />
                  승인 {nf(rv.approved)}
                </span>
                <span>
                  <span className="mr-1 inline-block size-2.5 rounded-sm bg-red-500 align-middle dark:bg-red-400" />
                  반려 {nf(rv.rejected)}
                </span>
                <span>미검토 {nf(rv.total - rv.reviewed)}</span>
              </p>
            </>
          )}
        </Card>
      </div>

      <Card title="최근 7일 검수 건수" note={workScope}>
        <DailyBars daily={d.daily} />
      </Card>
    </div>
  )
}

/** 하루 단위 막대 하나(단일 계열이라 범례 없이 제목이 이름을 대신한다). 막대에 올리면 값, 표로 보기를 켜면 같은 값을 표로 본다. */
function DailyBars({ daily }: { daily: { date: string; count: number }[] }) {
  const [table, setTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const maxValue = Math.max(...daily.map((x) => x.count), 0)
  const max = niceMax(maxValue)
  const grid = ticks(max)
  const total = daily.reduce((n, x) => n + x.count, 0)

  // SVG 좌표: 왼쪽에 눈금 숫자 자리, 아래에 날짜 라벨 자리
  const W = 640
  const H = 190
  const L = 34
  const B = 24
  const T = 14
  const plotH = H - B - T
  const slot = (W - L) / daily.length
  const barW = Math.min(36, slot * 0.5)
  const y = (v: number) => T + plotH * (1 - barRatio(v, max))

  if (table) {
    return (
      <div>
        <ChartToggle table onChange={setTable} />
        <table className="w-full max-w-sm text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">날짜</th>
              <th className="py-1.5 text-right font-medium">검수 건수</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((x) => (
              <tr key={x.date} className="border-b last:border-0">
                <td className="py-1.5">{dayLabel(x.date)}</td>
                <td className="py-1.5 text-right tabular-nums">{x.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div>
      <ChartToggle table={false} onChange={setTable} />
      {total === 0 && <p className="mb-1 text-sm text-muted-foreground">최근 7일 동안 검수한 기록이 없습니다.</p>}
      <div className="relative max-w-3xl">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`최근 7일 검수 건수: ${daily.map((x) => `${dayLabel(x.date)} ${x.count}건`).join(', ')}`}>
          {grid.map((g) => (
            <g key={g}>
              <line x1={L} x2={W} y1={y(g)} y2={y(g)} className={g === 0 ? 'stroke-border' : 'stroke-border/60'} strokeDasharray={g === 0 ? undefined : '3 4'} />
              <text x={L - 8} y={y(g) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {g}
              </text>
            </g>
          ))}
          {daily.map((x, i) => {
            const cx = L + slot * i + slot / 2
            const h = plotH * barRatio(x.count, max)
            const isToday = i === daily.length - 1
            return (
              <g key={x.date} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                {/* 마우스를 올릴 수 있는 칸은 막대보다 넓게 */}
                <rect x={L + slot * i} y={T} width={slot} height={plotH + B} fill="transparent" />
                {x.count > 0 && (
                  <rect x={cx - barW / 2} y={T + plotH - h} width={barW} height={h} rx={4} className={cn('fill-primary transition-opacity', hover !== null && hover !== i && 'opacity-50')} />
                )}
                {x.count > 0 && (isToday || x.count === maxValue) && (
                  <text x={cx} y={T + plotH - h - 5} textAnchor="middle" className="fill-foreground text-[11px] font-medium tabular-nums">
                    {x.count}
                  </text>
                )}
                <text x={cx} y={H - 6} textAnchor="middle" className={cn('text-[11px]', isToday ? 'fill-foreground font-medium' : 'fill-muted-foreground')}>
                  {dayLabel(x.date)}
                </text>
              </g>
            )
          })}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `${((L + slot * hover + slot / 2) / W) * 100}%`, top: 0 }}
          >
            <p className="text-muted-foreground">{dayLabel(daily[hover].date)}</p>
            <p className="font-semibold tabular-nums">{daily[hover].count}건</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ChartToggle({ table, onChange }: { table: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="mb-2 flex justify-end">
      <button type="button" onClick={() => onChange(!table)} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        {table ? '차트로 보기' : '표로 보기'}
      </button>
    </div>
  )
}
