import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/assignment/badges'
import { api } from '@/api'
import { fmtDuration, fmtMs } from '@/lib/format'
import { useCurrentUser } from '@/stores/auth'

const GAP_OPTIONS = [3, 5, 10, 15, 30]

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="rounded-lg border bg-card">{children}</div>
    </section>
  )
}

const Empty = ({ cols }: { cols: number }) => (
  <TableRow>
    <TableCell colSpan={cols} className="h-16 text-center text-muted-foreground">
      데이터가 없습니다.
    </TableCell>
  </TableRow>
)

export function TimeAnalysisPage() {
  const me = useCurrentUser()
  const isAdmin = me?.role === 'admin'
  const [gap, setGap] = useState(5)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['monitoring', 'time', gap],
    queryFn: () => api.timeAnalysis(gap),
    enabled: isAdmin,
    placeholderData: keepPreviousData,
  })

  if (!isAdmin) return <p className="p-6 text-sm text-muted-foreground">관리자만 볼 수 있는 화면입니다.</p>

  // 담당자별 값을 가중 평균해 전체 요약을 만든다
  const timed = data?.reviewers.reduce((s, r) => s + r.timedDecisions, 0) ?? 0
  const active = data?.reviewers.reduce((s, r) => s + r.activeSeconds, 0) ?? 0
  const images = data?.reviewers.reduce((s, r) => s + r.images, 0) ?? 0
  const idle = data?.reviewers.reduce((s, r) => s + r.idleGaps, 0) ?? 0
  const overturned = data?.reviewers.reduce((s, r) => s + r.overturned, 0) ?? 0
  const modelRuns = data?.models.reduce((s, m) => s + m.runs, 0) ?? 0
  const modelAvg = modelRuns ? data!.models.reduce((s, m) => s + m.avgMs * m.runs, 0) / modelRuns : null

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">소요 시간 분석</h1>
          <p className="text-sm text-muted-foreground">
            서버가 저장한 시각(검수 시각, 상태 이력, 배치 기록)으로 계산합니다. 브라우저에서 잰 시간은 쓰지 않습니다.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">자리 비움 기준</span>
          <Select
            items={GAP_OPTIONS.map((g) => ({ value: String(g), label: `${g}분 초과` }))}
            value={String(gap)}
            onValueChange={(v) => setGap(Number(v ?? 5))}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GAP_OPTIONS.map((g) => (
                <SelectItem key={g} value={String(g)}>
                  {g}분 초과
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="검수한 이미지" value={`${images.toLocaleString()}장`} hint={`번복 ${overturned}회`} />
            <Stat
              label="이미지당 작업 시간"
              value={fmtDuration(timed ? active / timed : null)}
              hint="자리 비움 구간 제외 평균"
            />
            <Stat label="제외된 자리 비움 구간" value={`${idle}회`} hint={`${gap}분 넘게 벌어진 간격`} />
            <Stat label="모델 처리 시간(장당)" value={fmtMs(modelAvg)} hint={`${modelRuns.toLocaleString()}회 평균`} />
            <Stat
              label="사전배치 처리 시간(장당)"
              value={fmtDuration(
                (() => {
                  const done = data.batches.filter((b) => b.secondsPerImage !== null)
                  const n = done.reduce((s, b) => s + b.processed, 0)
                  return n ? done.reduce((s, b) => s + (b.secondsPerImage ?? 0) * b.processed, 0) / n : null
                })(),
              )}
              hint="완료된 배치 가중 평균"
            />
          </div>

          <Section
            title="담당자별 검수 속도"
            desc={`같은 배정에서 연속된 검수 사이의 간격. ${gap}분을 넘긴 구간은 자리를 비운 것으로 보고 제외합니다.`}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>담당자</TableHead>
                  <TableHead className="text-right">검수 이미지</TableHead>
                  <TableHead className="text-right">번복</TableHead>
                  <TableHead className="text-right">평균 / 장</TableHead>
                  <TableHead className="text-right">중앙값 / 장</TableHead>
                  <TableHead className="text-right">실작업 시간</TableHead>
                  <TableHead className="text-right">자리 비움 구간</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.reviewers.length === 0 && <Empty cols={7} />}
                {data.reviewers.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.images}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.overturned}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(r.avgSecondsPerImage)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(r.medianSecondsPerImage)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(r.activeSeconds)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.idleGaps}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section
            title="배정별 소요 시간"
            desc="점검 시작 ~ 점검 완료 시간을 검수한 이미지 수로 나눕니다. 실작업은 자리 비움을 뺀 시간입니다."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>번호</TableHead>
                  <TableHead>배정명</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>담당자</TableHead>
                  <TableHead className="text-right">검수 / 전체</TableHead>
                  <TableHead className="text-right">점검 소요</TableHead>
                  <TableHead className="text-right">평균 / 장</TableHead>
                  <TableHead className="text-right">실작업 / 장</TableHead>
                  <TableHead className="text-right">배정~확인</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.assignments.length === 0 && <Empty cols={9} />}
                {data.assignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.id}</TableCell>
                    <TableCell className="font-medium">{a.title}</TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell>{a.assignee}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.reviewed}/{a.totalImages}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(a.reviewSeconds)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(a.avgSecondsPerImage)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(a.avgActiveSecondsPerImage)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(a.leadSeconds)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="모델 처리 시간" desc="모델 1장 처리 시간(model_runs.duration_ms), 모델 버전별">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>모델 버전</TableHead>
                    <TableHead className="text-right">실행 수</TableHead>
                    <TableHead className="text-right">평균</TableHead>
                    <TableHead className="text-right">p95</TableHead>
                    <TableHead className="text-right">최대</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.models.length === 0 && <Empty cols={5} />}
                  {data.models.map((m) => (
                    <TableRow key={m.modelVersion}>
                      <TableCell className="font-mono text-xs">{m.modelVersion}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.runs.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMs(m.avgMs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMs(m.p95Ms)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMs(m.maxMs)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            <Section title="사전배치 실행" desc="최근 50건 (batch_jobs). 실제 추론 연동 전에는 기록만 남습니다.">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>배정</TableHead>
                    <TableHead>결과</TableHead>
                    <TableHead className="text-right">처리 / 전체</TableHead>
                    <TableHead className="text-right">소요</TableHead>
                    <TableHead className="text-right">장당</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.batches.length === 0 && <Empty cols={5} />}
                  {data.batches.map((b, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{b.assignmentId}</TableCell>
                      <TableCell className="text-xs">{b.status === 'SUCCEEDED' ? '성공' : b.status === 'FAILED' ? '실패' : '진행'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.processed}/{b.total}
                        {b.failed > 0 && <span className="text-destructive"> (실패 {b.failed})</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtDuration(b.seconds)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtDuration(b.secondsPerImage)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
