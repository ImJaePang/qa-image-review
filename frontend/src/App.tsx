import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage, SignupPage } from '@/pages/AuthPages'
import { Placeholder } from '@/pages/Placeholder'
import { PLACEHOLDER_PATHS } from '@/config/menu'
import { useAuth } from '@/stores/auth'

// 화면 본문은 처음 열 때 내려받는다 (로그인·레이아웃만 첫 번들에 포함). 각 페이지는 named export라 default로 감싼다.
const AssignmentListPage = lazy(() => import('@/pages/AssignmentListPage').then((m) => ({ default: m.AssignmentListPage })))
const MyAssignmentsPage = lazy(() => import('@/pages/AssignmentListPage').then((m) => ({ default: () => <m.AssignmentListPage mine /> })))
const HistoryPage = lazy(() => import('@/pages/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const ImagesPage = lazy(() => import('@/pages/ImagesPage').then((m) => ({ default: m.ImagesPage })))
const TimeAnalysisPage = lazy(() => import('@/pages/TimeAnalysisPage').then((m) => ({ default: m.TimeAnalysisPage })))
const IntegrationsPage = lazy(() => import('@/pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })))
const RulesPage = lazy(() => import('@/pages/RulesPage').then((m) => ({ default: m.RulesPage })))
const UploadPage = lazy(() => import('@/pages/UploadPage').then((m) => ({ default: m.UploadPage })))
const UsersPage = lazy(() => import('@/pages/UsersPage').then((m) => ({ default: m.UsersPage })))
const RolesPage = lazy(() => import('@/pages/RolesPage').then((m) => ({ default: m.RolesPage })))
const MenusPage = lazy(() => import('@/pages/MenusPage').then((m) => ({ default: m.MenusPage })))

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })

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
              <Route path="/review/my-assignments" element={<MyAssignmentsPage />} />
              <Route path="/review/history" element={<HistoryPage />} />
              <Route path="/data/images" element={<ImagesPage />} />
              <Route path="/monitoring/time" element={<TimeAnalysisPage />} />
              <Route path="/settings/integrations" element={<IntegrationsPage />} />
              <Route path="/settings/rules" element={<RulesPage />} />
              <Route path="/data/upload" element={<UploadPage />} />
              <Route path="/settings/users" element={<UsersPage />} />
              <Route path="/settings/roles" element={<RolesPage />} />
              <Route path="/settings/menus" element={<MenusPage />} />
              {PLACEHOLDER_PATHS.map((p) => (
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
