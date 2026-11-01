import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/mock/api'
import { useAuth, useCurrentUser } from '@/stores/auth'
import type { Verdict } from '@/lib/types'

const VERDICTS: Verdict[] = ['정상', '의심', '불량']

export function NewAssignmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const me = useCurrentUser()
  const users = useAuth((s) => s.users)
  const qaUsers = users.filter((u) => u.role === 'qa')

  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [verdicts, setVerdicts] = useState<Verdict[]>(['의심', '불량'])
  const [count, setCount] = useState(10)

  const { data: free } = useQuery({ queryKey: ['unassigned'], queryFn: api.unassignedCounts, enabled: open })
  const available = free ? verdicts.reduce((sum, v) => sum + free[v], 0) : 0

  const create = useMutation({
    mutationFn: api.createAssignment,
    onSuccess: (a) => {
      toast.success(`${a.id} 배정 완료 (${a.imageIds.length}장 → ${a.assigneeName})`)
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
      <DialogContent className="max-w-lg">
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
              <Select items={qaUsers.map((u) => ({ value: u.id, label: u.name }))} value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="QA 담당자 선택" />
                </SelectTrigger>
                <SelectContent>
                  {qaUsers.map((u) => (
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

          <div className="space-y-2">
            <Label htmlFor="c">이미지 수</Label>
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
              <span className="text-sm text-muted-foreground">선택 가능한 미배정 이미지 {available}장</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            disabled={!valid || create.isPending}
            onClick={() => create.mutate({ title: title.trim(), assigneeId, dueDate, verdicts, count, actor: me?.name ?? '-' })}
          >
            {create.isPending ? '배정 중…' : '배정하기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
