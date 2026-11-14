import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/stores/auth'
import { MIN_PASSWORD, validatePasswordChange } from '@/lib/users'

/** 비밀번호 변경 입력 (강제 화면과 상단 메뉴의 변경 창이 함께 쓴다) */
export function ChangePasswordForm({ onDone, onCancel }: { onDone?: () => void; onCancel?: () => void }) {
  const changePassword = useAuth((s) => s.changePassword)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = validatePasswordChange(current, next, confirm)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await changePassword(current, next)
      toast.success('비밀번호를 변경했습니다')
      onDone?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cp-current">현재 비밀번호</Label>
        <Input id="cp-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cp-new">새 비밀번호</Label>
        <Input id="cp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        <p className="text-xs text-muted-foreground">{MIN_PASSWORD}자 이상, 현재 비밀번호와 달라야 합니다.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cp-confirm">새 비밀번호 확인</Label>
        <Input id="cp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            닫기
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          비밀번호 변경
        </Button>
      </div>
    </form>
  )
}
