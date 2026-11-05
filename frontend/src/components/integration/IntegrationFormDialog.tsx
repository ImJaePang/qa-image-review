import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, type FolderConfig, type Integration } from '@/api'
import { fmtDateTime } from '@/lib/domain'
import { describeHistory, parseExtensions } from '@/lib/integration'

interface Form {
  name: string
  watchDir: string
  processingDir: string
  doneDir: string
  failedDir: string
  extensions: string
  maxFileMB: string
  scanIntervalSec: string
}
const toForm = (name: string, c: FolderConfig): Form => ({
  name,
  watchDir: c.watchDir,
  processingDir: c.processingDir,
  doneDir: c.doneDir,
  failedDir: c.failedDir,
  extensions: c.extensions.join(' '),
  maxFileMB: String(c.maxFileMB),
  scanIntervalSec: String(c.scanIntervalSec),
})
/** 새 연계 추가(integration 없음) / 수정(integration 있음). 수정일 때는 변경 이력도 보여 준다. */
export function IntegrationFormDialog({
  open,
  onOpenChange,
  integration,
  root,
  defaults,
  suggestBase,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  integration: Integration | null
  root: string
  defaults: FolderConfig
  /** 새 연계의 폴더 이름 제안 (다른 연계와 겹치지 않는 하위 폴더) */
  suggestBase: string
}) {
  const qc = useQueryClient()
  const suggested = (): FolderConfig => ({
    ...defaults,
    watchDir: `${suggestBase}/${defaults.watchDir}`,
    processingDir: `${suggestBase}/${defaults.processingDir}`,
    doneDir: `${suggestBase}/${defaults.doneDir}`,
    failedDir: `${suggestBase}/${defaults.failedDir}`,
  })
  const [form, setForm] = useState<Form>(() => toForm('', suggested()))
  // 열릴 때(또는 대상·기본값이 바뀔 때) 폼을 다시 채운다
  const [prev, setPrev] = useState({ open: false, integration, defaults, suggestBase })
  if (prev.open !== open || prev.integration !== integration || prev.defaults !== defaults || prev.suggestBase !== suggestBase) {
    setPrev({ open, integration, defaults, suggestBase })
    if (open) setForm(integration ? toForm(integration.name, integration.config) : toForm('', suggested()))
  }
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const { data: history = [] } = useQuery({
    queryKey: ['integrations', integration?.id, 'history'],
    queryFn: () => api.integrationHistory(integration!.id),
    enabled: open && !!integration,
  })

  const save = useMutation({
    mutationFn: () => {
      const config: Partial<FolderConfig> = {
        watchDir: form.watchDir.trim(),
        processingDir: form.processingDir.trim(),
        doneDir: form.doneDir.trim(),
        failedDir: form.failedDir.trim(),
        extensions: parseExtensions(form.extensions),
        maxFileMB: Number(form.maxFileMB),
        scanIntervalSec: Number(form.scanIntervalSec),
      }
      return integration
        ? api.updateIntegration(integration.id, { name: form.name.trim(), config })
        : api.createIntegration({ name: form.name.trim(), config })
    },
    onSuccess: () => {
      toast.success(integration ? '저장했습니다' : '연계를 추가했습니다')
      qc.invalidateQueries({ queryKey: ['integrations'] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const numbersOk = Number(form.maxFileMB) > 0 && Number(form.scanIntervalSec) >= 1
  const valid =
    form.name.trim() && form.watchDir.trim() && form.processingDir.trim() && form.doneDir.trim() && form.failedDir.trim() && parseExtensions(form.extensions).length > 0 && numbersOk

  const dir = (k: 'watchDir' | 'processingDir' | 'doneDir' | 'failedDir', label: string, hint: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} value={form[k]} onChange={set(k)} className="font-mono text-sm" />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{integration ? '연계 수정' : '연계 추가'}</DialogTitle>
          <DialogDescription>
            폴더에 들어온 이미지를 자동으로 받아 AI 판정까지 마칩니다. 폴더는 허용 루트 아래의 상대 경로입니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">이름</Label>
            <Input id="name" value={form.name} onChange={set('name')} placeholder="예: 로컬 폴더 수신" />
          </div>

          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            허용 루트: <span className="font-mono break-all">{root}</span>
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {dir('watchDir', '감시 폴더', '여기에 파일을 넣으면 수신합니다')}
            {dir('processingDir', '처리 중 폴더', '수신한 파일이 판정을 기다리는 곳')}
            {dir('doneDir', '완료 폴더', '판정이 끝난 파일이 옮겨지는 곳')}
            {dir('failedDir', '실패 폴더', '검증·판정에 실패한 파일이 옮겨지는 곳')}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ext">파일 확장자</Label>
              <Input id="ext" value={form.extensions} onChange={set('extensions')} placeholder=".png .jpg" className="font-mono text-sm" />
              <p className="text-xs text-muted-foreground">공백 또는 쉼표로 구분</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mb">파일 크기 상한 (MB)</Label>
              <Input id="mb" type="number" min={1} value={form.maxFileMB} onChange={set('maxFileMB')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sec">스캔 주기 (초)</Label>
              <Input id="sec" type="number" min={1} value={form.scanIntervalSec} onChange={set('scanIntervalSec')} />
              <p className="text-xs text-muted-foreground">복사 중인 파일은 2번 연속 같을 때만 수신</p>
            </div>
          </div>

          {integration && (
            <div>
              <p className="mb-2 text-sm font-medium">변경 이력</p>
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground">이력이 없습니다.</p>
              ) : (
                <ul className="max-h-48 space-y-2 overflow-auto rounded-md border p-3 text-xs">
                  {history.map((h) => (
                    <li key={h.id}>
                      <span className="text-muted-foreground">
                        {fmtDateTime(h.at)} · {h.actor}
                      </span>
                      {describeHistory(h).map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {integration ? '저장' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
