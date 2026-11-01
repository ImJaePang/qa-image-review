import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage, SignupPage } from '@/pages/AuthPages'
import { AssignmentListPage } from '@/pages/AssignmentListPage'
import { Placeholder } from '@/pages/Placeholder'
import { MENU } from '@/config/menu'

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
const placeholderPaths = MENU.flatMap((m) => m.groups.flatMap((g) => g.items.map((i) => i.path))).filter(
  (p) => p !== '/review/assignments',
)

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route element={<AppLayout />}>
              <Route path="/review/assignments" element={<AssignmentListPage />} />
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
