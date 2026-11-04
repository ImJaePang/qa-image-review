import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Logo } from '@/components/layout/TopBar'
import { useQuery } from '@tanstack/react-query'
import { useAuth, useCurrentUser } from '@/stores/auth'
import type { SignupRole } from '@/lib/types'
import { PROFILE_LABEL, type ProfileKey } from '@/lib/users'
import { ApiError } from '@/api/client'
import { api } from '@/api'
import { useTheme } from '@/stores/theme'

function AuthShell({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  const { theme, toggle } = useTheme()
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Button variant="ghost" size="icon" className="absolute right-4 top-4" onClick={toggle} aria-label="테마 전환">
        {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{desc}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </div>
  )
}

export function LoginPage() {
  const user = useCurrentUser()
  const ready = useAuth((s) => s.ready)
  const login = useAuth((s) => s.login)
  const navigate = useNavigate()
  const loc = useLocation()
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('1234')
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const [busy, setBusy] = useState(false)

  if (ready && user) return <Navigate to="/review/assignments" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await login(email, password)
      navigate((loc.state as { from?: string } | null)?.from ?? '/review/assignments', { replace: true })
    } catch (err) {
      setError((err as Error).message)
      setExpired(err instanceof ApiError && err.code === 'EXPIRED')
    } finally {
      setBusy(false)
    }
  }

  // 만료된 계정: 로그인할 수 없으므로 여기서 해제를 요청한다 (본인 확인으로 같은 이메일·비밀번호를 다시 보낸다)
  const requestRelease = async () => {
    setBusy(true)
    try {
      const r = await api.requestExpiryRelease(email.trim(), password)
      setExpired(false)
      setError('')
      toast.success(r.message)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="로그인" desc="AI 생성 이미지 QA 검수 시스템">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">이메일</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pw">비밀번호</Label>
          <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {expired && (
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={requestRelease}>
            만료 해제 요청
          </Button>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          로그인
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          계정이 없나요?{' '}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            회원가입
          </Link>
        </p>
        <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          데모 계정: admin@example.com(관리자) / qa1@example.com(QA) · 비밀번호 1234
        </p>
      </form>
    </AuthShell>
  )
}

export function SignupPage() {
  const signup = useAuth((s) => s.signup)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const { data: signupRoles = [] } = useQuery({ queryKey: ['signup-roles'], queryFn: api.signupRoles })
  const [picked, setRequestedRole] = useState<SignupRole | null>(null)
  const requestedRole = picked ?? signupRoles.find((r) => r.code === 'qa')?.code ?? signupRoles[0]?.code ?? ''
  const [profile, setProfile] = useState<Record<ProfileKey, string>>({ company: '', department: '', jobTitle: '', phone: '', companyAddress: '' })
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (form.password.length < 4) return setError('비밀번호는 4자 이상이어야 합니다.')
    if (form.password !== form.confirm) return setError('비밀번호 확인이 일치하지 않습니다.')
    setBusy(true)
    try {
      // 가입은 승인 신청이다. 신청한 권한은 참고용이고, 실제 권한은 관리자가 승인하며 정한다.
      setDone(await signup(form.name, form.email, form.password, requestedRole, profile))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done)
    return (
      <AuthShell title="가입 신청 완료" desc="관리자 승인 후 로그인할 수 있습니다">
        <div className="space-y-4">
          <p className="rounded-md bg-muted p-3 text-sm">{done}</p>
          <Link to="/login" className={buttonVariants({ className: 'w-full' })}>
            로그인 화면으로
          </Link>
        </div>
      </AuthShell>
    )

  return (
    <AuthShell title="회원가입" desc="가입 신청 후 관리자가 승인하면 사용할 수 있습니다">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">이름</Label>
          <Input id="name" value={form.name} onChange={set('name')} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">이메일</Label>
          <Input id="email" type="email" value={form.email} onChange={set('email')} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pw">비밀번호</Label>
          <Input id="pw" type="password" value={form.password} onChange={set('password')} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pw2">비밀번호 확인</Label>
          <Input id="pw2" type="password" value={form.confirm} onChange={set('confirm')} required />
        </div>
        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">소속 · 연락처 <span className="font-normal text-muted-foreground">(선택)</span></p>
          {(Object.keys(PROFILE_LABEL) as ProfileKey[]).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`p-${k}`}>{PROFILE_LABEL[k]}</Label>
              <Input id={`p-${k}`} value={profile[k]} onChange={(e) => setProfile((p) => ({ ...p, [k]: e.target.value }))} />
            </div>
          ))}
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">신청 권한</legend>
          <div className="flex gap-4 text-sm">
            {signupRoles.map((r) => (
              <label key={r.code} className="flex items-center gap-1.5">
                <input type="radio" name="requestedRole" checked={requestedRole === r.code} onChange={() => setRequestedRole(r.code)} />
                {r.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">실제 권한은 관리자가 승인하면서 정합니다.</p>
        </fieldset>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          가입 신청
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          이미 계정이 있나요?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            로그인
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}
