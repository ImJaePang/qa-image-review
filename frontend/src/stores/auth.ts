import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Role, User } from '@/lib/types'
import { seedUsers } from '@/mock/data'

interface AuthState {
  users: User[]
  currentId: string | null
  login: (email: string, password: string) => User | null
  signup: (name: string, email: string, password: string, role: Role) => { ok: boolean; error?: string }
  logout: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      users: seedUsers,
      currentId: null,
      login: (email, password) => {
        const u = get().users.find((x) => x.email === email.trim() && x.password === password)
        if (!u) return null
        set({ currentId: u.id })
        return u
      },
      signup: (name, email, password, role) => {
        if (get().users.some((x) => x.email === email.trim())) return { ok: false, error: '이미 가입된 이메일입니다.' }
        const user: User = { id: `u_${Date.now()}`, name: name.trim(), email: email.trim(), password, role }
        set({ users: [...get().users, user] })
        return { ok: true }
      },
      logout: () => set({ currentId: null }),
    }),
    { name: 'qa-auth' },
  ),
)

export function useCurrentUser() {
  return useAuth((s) => s.users.find((u) => u.id === s.currentId) ?? null)
}
