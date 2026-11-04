import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, type Rule, type VerdictCounts } from '@/api'
import { fmtDateTime } from '@/lib/domain'
import { VERDICT_OF, describeRuleHistory, fmtParams, parseThreshold, thresholdProblem } from '@/lib/rules'
import { cn } from '@/lib/utils'
import { useCan } from '@/stores/auth'

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {desc && <p className="mt-1 text-xs text-muted-foreground">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

const KEYS = ['NORMAL', 'SUSPECT', 'DEFECT'] as const
const KEY_STYLE: Record<(typeof KEYS)[number], string> = {
  NORMAL: 'text-emerald-600 dark:text-emerald-400',
  SUSPECT: 'text-amber-600 dark:text-amber-400',
  DEFECT: 'text-red-600 dark:text-red-400',
}

function Distribution({ current, proposed }: { current: VerdictCounts; proposed: VerdictCounts }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {KEYS.map((k) => {
        const diff = proposed[k] - current[k]
        return (
          <div key={k} className="rounded-md border p-3">
            <p className={cn('text-xs font-medium', KEY_STYLE[k])}>{VERDICT_OF[k]}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {current[k].toLocaleString()} <span className="text-muted-foreground">→</span> {proposed[k].toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">{diff === 0 ? '변화 없음' : `${diff > 0 ? '+' : ''}${diff}`}</p>
          </div>
        )
      })}
    </div>
  )
}

export function RulesPage() {
  const isAdmin = useCan('rule.manage')
  const qc = useQueryClient()

  const { data, isLoading, isError, error } = useQuery({ queryKey: ['rules'], queryFn: api.listRules, enabled: isAdmin })
  const { data: history = [] } = useQuery({ queryKey: ['rules', 'history'], queryFn: api.ruleHistory, enabled: isAdmin })
  const active = data?.items.find((r) => r.active) ?? null

  // 입력칸은 활성 규칙의 값으로 시작한다
  const [normalStr, setNormalStr] = useState('')
  const [suspectStr, setSuspectStr] = useState('')
  const [scope, setScope] = useState<'unassigned' | 'all'>('unassigned')
  const activeKey = active ? `${active.id}:${active.params.normalMin}:${active.params.suspectMin}` : ''
  useEffect(() => {
    if (!active) return
    setNormalStr(String(active.params.normalMin))
    setSuspectStr(String(active.params.suspectMin))
    // 활성 규칙이 바뀔 때만 다시 채운다
  }, [activeKey])

  const normal = parseThreshold(normalStr)
  const suspect = parseThreshold(suspectStr)
  const problem = thresholdProblem(normal, suspect)
  const unchanged = !!active && normal === active.params.normalMin && suspect === active.params.suspectMin

  const { data: preview } = useQuery({
    queryKey: ['rules', 'preview', normal, suspect],
    queryFn: () => api.previewRule({ normalMin: normal!, suspectMin: suspect! }),
    enabled: isAdmin && !problem,
    placeholderData: keepPreviousData,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['rules'] })
    // 판정이 바뀌면 배정 목록의 판정별 건수와 신규 배정의 미배정 건수도 달라진다
    qc.invalidateQueries({ queryKey: ['assignments'] })
    qc.invalidateQueries({ queryKey: ['unassigned'] })
  }
  const onError = (e: Error) => toast.error(e.message)

  const create = useMutation({
    mutationFn: () => api.createRule({ normalMin: normal!, suspectMin: suspect! }),
    onSuccess: (r) => {
      toast.success(`v${r.version}을 만들었습니다. 새로 들어오는 이미지부터 적용됩니다 (이미 판정된 이미지는 재판정을 눌러야 바뀝니다)`)
      refresh()
    },
    onError,
  })
  const toggle = useMutation({
    mutationFn: (r: Rule) => api.setRuleEnabled(r.id, !r.enabled),
    onSuccess: (r) => {
      toast.success(r.enabled ? `v${r.version}을 켰습니다` : `v${r.version}을 껐습니다`)
      refresh()
    },
    onError,
  })
  const rejudge = useMutation({
    mutationFn: () => api.rejudge(active!.id, scope),
    onSuccess: (r) => {
      toast.success(`v${r.ruleVersion}으로 ${r.rejudged}장을 다시 판정했습니다 (${r.changed}장 바뀜)`)
      refresh()
    },
    onError,
  })

  if (!isAdmin) return <p className="p-6 text-sm text-muted-foreground">이 화면을 쓸 권한이 없습니다.</p>

  const stale = data?.stale ?? { unassigned: 0, assigned: 0 }
  const staleInScope = scope === 'all' ? stale.unassigned + stale.assigned : stale.unassigned
  const enabledCount = data?.items.filter((r) => r.enabled).length ?? 0

  const onRejudge = () => {
    if (scope === 'all' && !window.confirm('배정된 이미지까지 다시 판정합니다. 검수 중인 이미지의 AI 판정이 바뀔 수 있습니다. 계속할까요?')) return
    rejudge.mutate()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">임계값 / 규칙</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI 점수로 정상·의심·불량을 나누는 기준입니다. 규칙은 수정하지 않고 새 버전으로 쌓이며, 판정마다 어떤 버전으로 했는지 기록됩니다.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
      {isError && <p className="text-sm text-red-600">{(error as Error).message}</p>}

      {active && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-5 py-4">
          <span className="text-sm text-muted-foreground">현재 활성</span>
          <span className="text-lg font-semibold">v{active.version}</span>
          <span className="font-mono text-sm">{fmtParams(active.params)}</span>
          {stale.unassigned + stale.assigned > 0 && (
            <Badge className="ml-auto border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              재판정 필요: 미배정 {stale.unassigned.toLocaleString()}장
              {stale.assigned > 0 && ` · 배정됨 ${stale.assigned.toLocaleString()}장`}
            </Badge>
          )}
        </div>
      )}

      <Section title="새 버전 만들기" desc="저장하면 새로 들어오는 이미지부터 이 기준으로 판정됩니다. 이미 판정된 이미지는 아래에서 재판정해야 바뀝니다.">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="nm">정상 기준 (이상)</Label>
            <Input id="nm" className="w-32" inputMode="decimal" value={normalStr} onChange={(e) => setNormalStr(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sm">의심 기준 (이상)</Label>
            <Input id="sm" className="w-32" inputMode="decimal" value={suspectStr} onChange={(e) => setSuspectStr(e.target.value)} />
          </div>
          <Button disabled={!!problem || unchanged || create.isPending} onClick={() => create.mutate()}>
            새 버전으로 저장
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">정상 기준 이상이면 정상, 의심 기준 이상이면 의심, 그 아래는 불량입니다.</p>

        {problem && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{problem}</p>}
        {!problem && preview && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium">
              미리보기 <span className="font-normal text-muted-foreground">— 지금 판정과 비교, 전체 {preview.total.toLocaleString()}장</span>
            </p>
            <Distribution current={preview.current} proposed={preview.proposed} />
            <p className="text-xs text-muted-foreground">
              판정이 바뀌는 이미지: 미배정 {preview.changed.unassigned.toLocaleString()}장 · 배정됨 {preview.changed.assigned.toLocaleString()}장
              {unchanged && ' (활성 규칙과 같은 값입니다)'}
            </p>
          </div>
        )}
      </Section>

      <Section title="재판정" desc="모델을 다시 돌리지 않고, 저장된 점수에 활성 규칙을 적용해 판정을 새로 남깁니다. 옛 판정은 지워지지 않습니다.">
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" checked={scope === 'unassigned'} onChange={() => setScope('unassigned')} />
            미배정만 <span className="text-xs text-muted-foreground">(권장: 검수 중인 이미지는 그대로)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
            배정된 이미지 포함 <span className="text-xs text-amber-600 dark:text-amber-400">(검수 중인 이미지의 AI 판정이 바뀝니다)</span>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="outline" disabled={!active || staleInScope === 0 || rejudge.isPending} onClick={onRejudge}>
            {active ? `v${active.version}으로 재판정` : '재판정'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {staleInScope === 0 ? '이 범위에는 다시 판정할 이미지가 없습니다' : `${staleInScope.toLocaleString()}장이 대상입니다`}
          </span>
        </div>
      </Section>

      <Section title="버전" desc="새 버전을 끄면 이전 버전이 활성이 됩니다(되돌리기). 이후 재판정을 눌러야 판정도 돌아갑니다.">
        <ul className="divide-y rounded-md border">
          {data?.items.map((r) => (
            <li key={r.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3', !r.enabled && 'opacity-60')}>
              <span className="w-10 font-semibold">v{r.version}</span>
              {r.active && <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">활성</Badge>}
              {!r.enabled && <Badge variant="outline">꺼짐</Badge>}
              <span className="font-mono text-sm">{fmtParams(r.params)}</span>
              <span className="text-xs text-muted-foreground">
                {fmtDateTime(r.createdAt)} · {r.createdBy} · 판정 {r.verdictCount.toLocaleString()}건
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={toggle.isPending || (r.enabled && enabledCount <= 1)}
                title={r.enabled && enabledCount <= 1 ? '켜진 규칙이 하나는 있어야 합니다' : undefined}
                onClick={() => toggle.mutate(r)}
              >
                {r.enabled ? '끄기' : '켜기'}
              </Button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="변경 이력">
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">이력이 없습니다.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-3">
                <span className="w-44 shrink-0 text-xs text-muted-foreground">
                  {fmtDateTime(h.at)} · {h.actor}
                </span>
                <span>{describeRuleHistory(h)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
