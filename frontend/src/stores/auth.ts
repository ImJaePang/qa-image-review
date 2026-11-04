import { create } from 'zustand'
import type { SignupRole, User } from '@/lib/types'
import { api } from '@/api'
import { setUnauthorizedHandler } from '@/api/client'

// 세션은 서버가 httpOnly 쿠키로 관리한다. 여기서는 현재 사용자만 메모리에 둔다.
interface AuthState {
  user: User | null
  /** 앱 시작 시 세션 확인이 끝났는지 */
  ready: boolean
  init: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  /** 가입 신청. 로그인되지 않으며 승인 대기 안내 문구를 돌려준다 */
  signup: (name: string, email: string, password: string, requestedRole: SignupRole) => Promise<string>
  logout: () => Promise<void>
}

export const useAuth = create<AuthState>()((set) => ({
  user: null,
  ready: false,
  init: async () => {
    try {
      set({ user: await api.me(), ready: true })
    } catch {
      set({ user: null, ready: true })
    }
  },
  login: async (email, password) => set({ user: await api.login(email.trim(), password) }),
  signup: async (name, email, password, requestedRole) => (await api.signup(name, email, password, requestedRole)).message,
  logout: async () => {
    await api.logout().catch(() => undefined)
    set({ user: null })
  },
}))

// 세션 만료(401) 시 로그인 화면으로 보낸다
setUnauthorizedHandler(() => useAuth.setState({ user: null }))

export function useCurrentUser() {
  return useAuth((s) => s.user)
}
