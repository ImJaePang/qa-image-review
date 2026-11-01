import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Logo } from '@/components/layout/TopBar'
import { useAuth, useCurrentUser } from '@/stores/auth'
import { useTheme } from '@/stores/theme'
import type { Role } from '@/lib/types'

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
  const login = useAuth((s) => s.login)
  const navigate = useNavigate()
  const loc = useLocation()
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('1234')
  const [error, setError] = useState('')

  if (user) return <Navigate to="/review/assignments" replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!login(email, password)) return setError('이메일 또는 비밀번호가 올바르지 않습니다.')
    navigate((loc.state as { from?: string } | null)?.from ?? '/review/assignments', { replace: true })
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
        <Button type="submit" className="w-full">
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
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [role, setRole] = useState<Role>('qa')
  const [error, setError] = useState('')
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (form.password.length < 4) return setError('비밀번호는 4자 이상이어야 합니다.')
    if (form.password !== form.confirm) return setError('비밀번호 확인이 일치하지 않습니다.')
    const res = signup(form.name, form.email, form.password, role)
    if (!res.ok) return setError(res.error ?? '가입에 실패했습니다.')
    navigate('/login')
  }

  return (
    <AuthShell title="회원가입" desc="새 계정을 만들어 시작하세요">
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
          <Label>역할</Label>
          <Select items={[{ value: 'qa', label: 'QA 담당자' }, { value: 'admin', label: '관리자' }]} value={role} onValueChange={(v) => setRole((v ?? "qa") as Role)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="qa">QA 담당자</SelectItem>
              <SelectItem value="admin">관리자</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pw">비밀번호</Label>
          <Input id="pw" type="password" value={form.password} onChange={set('password')} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pw2">비밀번호 확인</Label>
          <Input id="pw2" type="password" value={form.confirm} onChange={set('confirm')} required />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full">
          가입하기
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
