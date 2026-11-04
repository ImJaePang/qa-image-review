import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage, SignupPage } from '@/pages/AuthPages'
import { AssignmentListPage } from '@/pages/AssignmentListPage'
import { Placeholder } from '@/pages/Placeholder'
import { IMPLEMENTED, MENU } from '@/config/menu'
import { TimeAnalysisPage } from '@/pages/TimeAnalysisPage'
import { IntegrationsPage } from '@/pages/IntegrationsPage'
import { UsersPage } from '@/pages/UsersPage'
import { RulesPage } from '@/pages/RulesPage'
import { useAuth } from '@/stores/auth'

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
const placeholderPaths = MENU.flatMap((m) => m.groups.flatMap((g) => g.items.map((i) => i.path))).filter(
  (p) => !IMPLEMENTED.has(p),
)

export default function App() {
  const init = useAuth((s) => s.init)
  useEffect(() => {
    init()
  }, [init])
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route element={<AppLayout />}>
              <Route path="/review/assignments" element={<AssignmentListPage />} />
              <Route path="/monitoring/time" element={<TimeAnalysisPage />} />
              <Route path="/settings/integrations" element={<IntegrationsPage />} />
              <Route path="/settings/rules" element={<RulesPage />} />
              <Route path="/settings/users" element={<UsersPage />} />
              {placeholderPaths.map((p) => (
                <Route key={p} path={p} element={<Placeholder />} />
              ))}
            </Route>
            <Route path="*" element={<Navigate to="/review/assignments" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="top-center" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
