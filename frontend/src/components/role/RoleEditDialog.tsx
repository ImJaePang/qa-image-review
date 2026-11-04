import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/api'
import { fmtDate, fmtDateTime } from '@/lib/domain'
import { ROLE_CODE_PATTERN, ROLE_DESCRIPTION_MAX, ROLE_LABEL_MAX, describeRoleHistory, validateRoleForm } from '@/lib/roles'

export type RoleDialogTarget = { mode: 'new' } | { mode: 'edit'; code: string }

const section = 'border-b pb-1 text-xs font-semibold text-primary'

/** 권한 신규/수정을 한 모달로. 코드는 만들 때만 입력하고 이후에는 바꿀 수 없다. */
export function RoleEditDialog({ target, onClose }: { target: RoleDialogTarget | null; onClose: () => void }) {
  const qc = useQueryClient()
  const isNew = target?.mode === 'new'
  const code = target?.mode === 'edit' ? target.code : null
  const { data } = useQuery({ queryKey: ['admin-roles', 'one', code], queryFn: () => api.getAdminRole(code!), enabled: !!code })
  const role = data?.role

  const [newCode, setNewCode] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [signup, setSignup] = useState(false)
  const [sortOrder, setSortOrder] = useState('')

  // 열 때(신규) 또는 처음 불러왔을 때(수정)만 폼을 채운다
  useEffect(() => {
    if (!target) return
    if (target.mode === 'new') {
      setNewCode('')
      setLabel('')
      setDescription('')
      setSignup(false)
      setSortOrder('')
    }
  }, [target])
  useEffect(() => {
    if (!role) return
    setLabel(role.label)
    setDescription(role.description ?? '')
    setSignup(role.signupSelectable)
    setSortOrder(String(role.sortOrder))
  }, [role?.code]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-roles'] })
    qc.invalidateQueries({ queryKey: ['roles'] })
    qc.invalidateQueries({ queryKey: ['permissions'] })
  }
  const problem = validateRoleForm({ isNew: !!isNew, code: newCode, label, description, sortOrder })
  const sortNum = sortOrder.trim() === '' ? undefined : Number(sortOrder)

  const create = useMutation({
    mutationFn: () => api.createRole({ code: newCode, label: label.trim(), description: description.trim() || null, signupSelectable: signup, sortOrder: sortNum }),
    onSuccess: () => {
      toast.success('권한을 만들었습니다. 「권한별 메뉴」에서 허용할 메뉴를 정하세요.')
      refresh()
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const save = useMutation({
    mutationFn: () => {
      if (!role) throw new Error('불러오는 중입니다')
      const input: Parameters<typeof api.updateRole>[1] = {}
      if (label.trim() !== role.label) input.label = label.trim()
      if ((description.trim() || null) !== role.description) input.description = description.trim() || null
      if (!role.system && signup !== role.signupSelectable) input.signupSelectable = signup
      if (sortNum !== undefined && sortNum !== role.sortOrder) input.sortOrder = sortNum
      if (!Object.keys(input).length) throw new Error('바뀐 내용이 없습니다')
      return api.updateRole(role.code, input)
    },
    onSuccess: () => {
      toast.success('저장했습니다')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const toggle = useMutation({
    mutationFn: (active: boolean) => api.setRoleActive(role!.code, active),
    onSuccess: (_r, active) => {
      toast.success(active ? '다시 사용합니다' : '사용 안 함으로 바꿨습니다')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteRole(role!.code),
    onSuccess: () => {
      toast.success('삭제했습니다')
      refresh()
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const busy = create.isPending || save.isPending || toggle.isPending || remove.isPending
  const onSubmit = () => {
    if (problem) return toast.error(problem)
    ;(isNew ? create : save).mutate()
  }

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{isNew ? '새 권한' : `권한 수정${role ? ` — ${role.label}` : ''}`}</DialogTitle>
            {role && <Badge variant={role.active ? 'default' : 'secondary'}>{role.active ? '사용 중' : '사용 안 함'}</Badge>}
            {role?.system && <Badge variant="outline">시스템</Badge>}
          </div>
          <DialogDescription>
            {isNew ? '권한 종류를 만듭니다. 무엇을 쓸 수 있는지는 「권한별 메뉴」에서 정합니다.' : role ? `만든 날 ${fmtDate(role.createdAt)}` : '불러오는 중…'}
          </DialogDescription>
        </DialogHeader>

        {(isNew || role) && (
          <div className="space-y-5">
            <section className="space-y-3">
              <h3 className={section}>기본 정보</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="r-code">코드{isNew && ' *'}</Label>
                  {isNew ? (
                    <Input id="r-code" value={newCode} onChange={(e) => setNewCode(e.target.value.trim())} placeholder="예: auditor" maxLength={30} aria-invalid={!!newCode && !ROLE_CODE_PATTERN.test(newCode)} />
                  ) : (
                    <Input id="r-code" value={role!.code} readOnly className="bg-muted font-mono text-muted-foreground" />
                  )}
                  <p className="text-xs text-muted-foreground">{isNew ? '영문 소문자·숫자·밑줄. 만든 뒤에는 바꿀 수 없습니다.' : '코드는 바꿀 수 없습니다.'}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="r-label">이름 *</Label>
                  <Input id="r-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={ROLE_LABEL_MAX} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-desc">설명</Label>
                <Textarea id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={ROLE_DESCRIPTION_MAX} rows={3} placeholder="선택 입력. 「권한별 메뉴」 표의 열 머리에 마우스를 올리면 보입니다." />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>가입 신청</Label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-primary" checked={signup} disabled={role?.system} onChange={(e) => setSignup(e.target.checked)} />
                    가입 화면에서 이 권한을 신청할 수 있게 함
                  </label>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="r-sort">표시 순서</Label>
                  <Input id="r-sort" className="w-28" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder={isNew ? '자동' : ''} />
                </div>
              </div>
              {isNew && (
                <p className="rounded-md border border-primary/30 bg-accent px-3 py-2 text-sm">
                  새 권한은 <b>메뉴 접근이 하나도 없는 상태</b>로 만들어집니다. 만든 뒤 「권한별 메뉴」에서 허용할 메뉴를 정하세요.
                </p>
              )}
            </section>

            {role && (
              <>
                <section className="space-y-2">
                  <h3 className={section}>사용 현황</h3>
                  <p className="text-sm">
                    이 권한을 가진 사용자 <b className="tabular-nums">{role.userCount}명</b>
                    {role.userCount > 0 && (
                      <>
                        {' · '}
                        <Link to="/settings/users" className="text-primary hover:underline" onClick={onClose}>
                          사용자 관리에서 보기
                        </Link>
                      </>
                    )}
                  </p>
                </section>

                <section className="space-y-2">
                  <h3 className={section}>변경 이력</h3>
                  {!data || data.history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">이력이 없습니다.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {data.history.map((h) => (
                        <li key={h.id} className="flex gap-3">
                          <span className="w-36 shrink-0 tabular-nums text-muted-foreground">{fmtDateTime(h.at)}</span>
                          <span className="w-20 shrink-0 text-muted-foreground">{h.actor}</span>
                          <span>{describeRoleHistory(h).join(' · ')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            {role && !role.system && role.active && (
              <Button variant="destructive" disabled={busy} onClick={() => confirm('사용 안 함으로 바꿀까요? 새 가입·승인·권한 변경에서 빠지고, 이미 가진 사용자는 그대로 씁니다.') && toggle.mutate(false)}>
                사용 안 함으로 전환
              </Button>
            )}
            {role && !role.active && (
              <Button variant="outline" disabled={busy} onClick={() => toggle.mutate(true)}>
                다시 사용
              </Button>
            )}
            {role?.deletable && (
              <Button variant="destructive" disabled={busy} onClick={() => confirm('이 권한을 삭제할까요? 되돌릴 수 없습니다.') && remove.mutate()}>
                삭제
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {isNew ? '취소' : '닫기'}
            </Button>
            <Button disabled={busy || (!isNew && !role)} onClick={onSubmit}>
              {isNew ? '만들기' : '저장'}
            </Button>
          </div>
        </DialogFooter>
        {role && !role.system && (
          <p className="text-xs text-muted-foreground">
            「사용 안 함」: 새 가입 신청·승인·권한 변경에서 빠지고, 이미 가진 사용자는 그대로 씁니다. 사용자와 변경 이력이 없으면 삭제도 할 수 있습니다.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
