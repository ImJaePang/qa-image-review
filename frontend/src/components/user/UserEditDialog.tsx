import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/api'
import { fmtDate, fmtDateTime } from '@/lib/domain'
import { useRoles } from '@/hooks/useRoles'
import type { Role } from '@/lib/types'
import { BULK_LABEL, PROFILE_LABEL, USER_STATUS_LABEL, describeUserHistory, type BulkAction, type ProfileKey, type UserProfile } from '@/lib/users'

const PROFILE_KEYS = Object.keys(PROFILE_LABEL) as ProfileKey[]

export function RoleSelect({ value, onChange, disabled, className }: { value: Role; onChange: (r: Role) => void; disabled?: boolean; className?: string }) {
  const { roles } = useRoles()
  // 사용 안 함 권한은 고를 수 없지만, 지금 값이 그 권한이면 그대로 보이게 한다
  const roleItems = roles.filter((r) => r.active || r.code === value).map((r) => ({ value: r.code, label: r.label }))
  return (
    <Select items={roleItems} value={value} onValueChange={(v) => v && onChange(v as Role)} disabled={disabled}>
      <SelectTrigger className={className ?? 'w-40'} aria-label="권한">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roleItems.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** 사용자 수정: 권한·사용기한·소속·연락처, 상태에 맞는 처리(승인/반려/비활성/재활성/만료 해제), 임시 비밀번호, 변경 이력 */
export function UserEditDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { roleLabel } = useRoles()
  const { data: user } = useQuery({ queryKey: ['admin-users', 'one', userId], queryFn: () => api.getAdminUser(userId!), enabled: !!userId })
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('qa')
  const [expires, setExpires] = useState('')
  const [profile, setProfile] = useState<UserProfile>({ company: '', department: '', jobTitle: '', phone: '', companyAddress: '' })
  const [tempPw, setTempPw] = useState<string | null>(null)

  // 처음 불러왔을 때만 폼을 채운다 (저장 후 다시 불러와도 입력 중인 값을 덮지 않도록 사용자 id 기준)
  useEffect(() => {
    if (!user) return
    setName(user.name)
    setRole(user.status === 'PENDING' ? (user.requestedRole ?? 'qa') : user.role)
    setExpires(user.expiresAt ? fmtDate(user.expiresAt) : '')
    setProfile(user.profile)
    setTempPw(null)
  }, [user?.id, user?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] })
  }

  const save = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('불러오는 중입니다')
      const input: Parameters<typeof api.updateAdminUser>[1] = {}
      if (name.trim() !== user.name) input.name = name.trim()
      if (user.status !== 'PENDING' && role !== user.role) input.role = role
      if (expires && expires !== (user.expiresAt ? fmtDate(user.expiresAt) : '')) input.expiresAt = new Date(`${expires}T23:59:59`).toISOString()
      const changed: Partial<UserProfile> = {}
      for (const k of PROFILE_KEYS) if (profile[k].trim() !== user.profile[k]) changed[k] = profile[k]
      if (Object.keys(changed).length) input.profile = changed
      if (!Object.keys(input).length) throw new Error('바뀐 내용이 없습니다')
      return api.updateAdminUser(user.id, input)
    },
    onSuccess: () => {
      toast.success('저장했습니다')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const act = useMutation({
    mutationFn: ({ action, withRole }: { action: BulkAction; withRole?: Role }) => api.bulkUsers(action, [user!.id], withRole),
    onSuccess: (r, { action }) => {
      if (r.skipped.length) toast.error(r.skipped[0].reason)
      else toast.success(`${BULK_LABEL[action]}했습니다`)
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const reset = useMutation({
    mutationFn: () => api.resetPassword(user!.id),
    onSuccess: (r) => {
      setTempPw(r.tempPassword)
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const busy = save.isPending || act.isPending || reset.isPending
  const status = user?.status

  return (
    <Dialog open={!!userId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>사용자 수정{user ? ` — ${user.name}` : ''}</DialogTitle>
            {status && <Badge variant={status === 'ACTIVE' ? 'default' : 'secondary'}>{USER_STATUS_LABEL[status]}</Badge>}
          </div>
          <DialogDescription>
            {user ? `${user.email} · 가입 ${fmtDate(user.createdAt)} · 마지막 로그인 ${user.lastLoginAt ? fmtDateTime(user.lastLoginAt) : '없음'}` : '불러오는 중…'}
          </DialogDescription>
        </DialogHeader>

        {user && (
          <div className="space-y-5">
            <section className="space-y-3">
              <h3 className="border-b pb-1 text-xs font-semibold text-primary">계정</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{status === 'PENDING' ? '승인할 권한' : '권한'}</Label>
                  <RoleSelect value={role} onChange={setRole} className="w-full" />
                  {status === 'PENDING' && <p className="text-xs text-muted-foreground">신청 권한: {user.requestedRole ? roleLabel(user.requestedRole) : '-'}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expires">사용기한</Label>
                  <Input id="expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} disabled={status === 'PENDING' || status === 'DISABLED'} />
                  <p className="text-xs text-muted-foreground">
                    {status === 'EXPIRED' ? '미래 날짜로 저장하면 만료가 해제됩니다. ' : ''}로그인할 때마다 1년 뒤로 갱신됩니다.
                  </p>
                </div>
              </div>
              {user.expiryReleaseRequestedAt && (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">만료 해제 요청: {fmtDateTime(user.expiryReleaseRequestedAt)}</p>
              )}
              <div>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => reset.mutate()}>
                  임시 비밀번호로 초기화
                </Button>
              </div>
              {tempPw && (
                <div className="rounded-md border border-primary/40 bg-accent px-3 py-2 text-sm">
                  임시 비밀번호: <span className="select-all font-mono font-semibold">{tempPw}</span>
                  <Button variant="ghost" size="xs" className="ml-2" onClick={() => navigator.clipboard?.writeText(tempPw).then(() => toast.success('복사했습니다'))}>
                    복사
                  </Button>
                  <p className="mt-1 text-xs text-muted-foreground">이 창을 닫으면 다시 볼 수 없습니다. 사용자에게 전달해 주세요.</p>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="border-b pb-1 text-xs font-semibold text-primary">소속 · 연락처</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="u-name">이름</Label>
                  <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                {PROFILE_KEYS.map((k) => (
                  <div key={k} className="space-y-1.5">
                    <Label htmlFor={`p-${k}`}>{PROFILE_LABEL[k]}</Label>
                    <Input id={`p-${k}`} value={profile[k]} onChange={(e) => setProfile((p) => ({ ...p, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="border-b pb-1 text-xs font-semibold text-primary">변경 이력</h3>
              {user.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">이력이 없습니다.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {user.history.map((h) => (
                    <li key={h.id} className="flex gap-3">
                      <span className="w-36 shrink-0 tabular-nums text-muted-foreground">{fmtDateTime(h.at)}</span>
                      <span className="w-24 shrink-0 text-muted-foreground">{h.actor ?? "본인·시스템"}</span>
                      <span>{describeUserHistory(h, roleLabel).join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            {status === 'PENDING' && (
              <Button variant="destructive" disabled={busy} onClick={() => confirm('가입을 반려할까요?') && act.mutate({ action: 'REJECT' })}>
                반려
              </Button>
            )}
            {(status === 'ACTIVE' || status === 'EXPIRED') && (
              <Button variant="destructive" disabled={busy} onClick={() => confirm('이 사용자를 비활성화할까요? 이미 로그인한 상태도 바로 끊깁니다.') && act.mutate({ action: 'DISABLE' })}>
                비활성화
              </Button>
            )}
            {status === 'DISABLED' && (
              <Button variant="outline" disabled={busy} onClick={() => act.mutate({ action: 'ENABLE' })}>
                재활성화 (+1년)
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            {status === 'PENDING' ? (
              <Button disabled={busy} onClick={() => act.mutate({ action: 'APPROVE', withRole: role })}>
                {roleLabel(role)}로 승인
              </Button>
            ) : (
              <>
                {status === 'EXPIRED' && (
                  <Button variant="outline" disabled={busy} onClick={() => act.mutate({ action: 'RELEASE_EXPIRY' })}>
                    만료 해제 (+1년)
                  </Button>
                )}
                <Button disabled={busy || !user} onClick={() => save.mutate()}>
                  저장
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
