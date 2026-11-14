import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/api'
import type { Verdict } from '@/lib/types'
import { DEFAULT_NORMAL_PERCENT, IMAGE_ORDERS, ORDER_DESC, ORDER_LABEL, assignmentPreview, sampleSize, type ImageOrder } from '@/lib/imageSort'

const VERDICTS: Verdict[] = ['정상', '의심', '불량']

export function NewAssignmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const { data: assignees = [] } = useQuery({ queryKey: ['assignees'], queryFn: api.listAssignees, enabled: open })

  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [verdicts, setVerdicts] = useState<Verdict[]>(['의심', '불량'])
  const [count, setCount] = useState(10)
  // 검수 순서(배정 안에 고정)와 정상 표본 비율: 정상을 대상에 넣었을 때만 쓴다
  const [order, setOrder] = useState<ImageOrder>('score_asc')
  const [normalPercent, setNormalPercent] = useState<number>(DEFAULT_NORMAL_PERCENT)

  const { data: free } = useQuery({ queryKey: ['unassigned'], queryFn: api.unassignedCounts, enabled: open })
  const wantsNormal = verdicts.includes('정상')
  const preview = free ? assignmentPreview(free, verdicts, normalPercent, count) : { normal: 0, others: 0, candidates: 0, total: 0 }
  const available = preview.candidates

  const create = useMutation({
    mutationFn: api.createAssignment,
    onSuccess: (a) => {
      toast.success(`${a.id} 배정 완료 (${a.count}장 → ${assignees.find((u) => u.id === assigneeId)?.name ?? '-'})`)
      qc.invalidateQueries({ queryKey: ['assignments'] })
      qc.invalidateQueries({ queryKey: ['unassigned'] })
      setTitle('')
      setAssigneeId('')
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const valid = title.trim() && assigneeId && dueDate && verdicts.length > 0 && count > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>신규 배정</DialogTitle>
          <DialogDescription>QA 담당자에게 확인할 이미지를 넘깁니다. 이미 배정된 이미지는 제외됩니다.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="t">배정명</Label>
            <Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 주력전차 3차 배치" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>담당자</Label>
              <Select items={assignees.map((u) => ({ value: u.id, label: u.name }))} value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="QA 담당자 선택" />
                </SelectTrigger>
                <SelectContent>
                  {assignees.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="d">마감일</Label>
              <Input id="d" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>대상 AI 판정</Label>
            <ToggleGroup
              multiple
              variant="outline"
              value={verdicts}
              onValueChange={(v) => setVerdicts(v as Verdict[])}
              className="justify-start"
            >
              {VERDICTS.map((v) => (
                <ToggleGroupItem key={v} value={v} className="px-4">
                  {v}
                  {free && <span className="ml-1.5 text-xs text-muted-foreground">{free[v]}</span>}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {wantsNormal && (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium">정상은 표본만</span>
                <Slider className="flex-1" value={[normalPercent]} min={1} max={100} onValueChange={(v) => setNormalPercent(Array.isArray(v) ? v[0] : v)} aria-label="정상 표본 비율" />
                <span className="w-10 text-right tabular-nums" data-testid="normal-percent">
                  {normalPercent}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                AI가 ‘정상’이라 한 이미지 중 무작위로 일부만 사람이 확인합니다{free ? ` (정상 ${free['정상'].toLocaleString()}장 중 약 ${sampleSize(free['정상'], normalPercent).toLocaleString()}장)` : ''}. 의심·불량은 항상 전부 대상입니다.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>검수 순서</Label>
            <Select items={IMAGE_ORDERS.map((o) => ({ value: o, label: ORDER_LABEL[o] }))} value={order} onValueChange={(v) => setOrder((v ?? 'score_asc') as ImageOrder)}>
              <SelectTrigger className="w-full" aria-label="검수 순서">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_ORDERS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {ORDER_LABEL[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ORDER_DESC[order]}. 이 순서가 배정 안에 고정되며, 검수 화면에서 다른 정렬로 바꿔 볼 수도 있습니다.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="c">이미지 수 (최대)</Label>
            <div className="flex items-center gap-3">
              <Input
                id="c"
                type="number"
                min={1}
                max={Math.max(available, 1)}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">선택 가능한 미배정 이미지 {available.toLocaleString()}장</span>
            </div>
          </div>
          <p className="border-t pt-3 text-sm" data-testid="assign-summary">
            배정 대상 <b className="tabular-nums">{preview.candidates.toLocaleString()}장</b>
            {wantsNormal && <span className="text-muted-foreground"> (정상 표본 {preview.normal.toLocaleString()} + 의심·불량 {preview.others.toLocaleString()})</span>}
            {preview.candidates > preview.total && <span> → 이미지 수 상한으로 <b className="tabular-nums">{preview.total.toLocaleString()}장</b>만 담깁니다</span>}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            disabled={!valid || create.isPending}
            onClick={() => create.mutate({ title: title.trim(), assigneeId, dueDate, verdicts, count, order, normalPercent: wantsNormal ? normalPercent : 100 })}
          >
            {create.isPending ? '배정 중…' : '배정하기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
