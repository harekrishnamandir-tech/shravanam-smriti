import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { AdminsPage } from './features/admin/AdminsPage'
import { CourseEditPage } from './features/admin/CourseEditPage'
import { CoursesAdminPage } from './features/admin/CoursesAdminPage'
import { ParticipantsAdminPage } from './features/admin/ParticipantsAdminPage'
import { useAuth } from './features/auth/AuthProvider'
import { LoginPage, NoAccessPage, NotConfiguredPage } from './features/auth/LoginPage'
import { SessionsPage } from './features/course/SessionsPage'
import { UploadPage } from './features/upload/UploadPage'
import { isConfigured } from './lib/supabase'

// Chart-heavy pages load ECharts on demand.
const CoursePage = lazy(() => import('./features/course/CoursePage').then((m) => ({ default: m.CoursePage })))
const OverviewPage = lazy(() => import('./features/overview/OverviewPage').then((m) => ({ default: m.OverviewPage })))
const DevoteePage = lazy(() => import('./features/participant/DevoteePage').then((m) => ({ default: m.DevoteePage })))
const ParticipantPage = lazy(() => import('./features/participant/ParticipantPage').then((m) => ({ default: m.ParticipantPage })))

export default function App() {
  const { session, ready, me, meLoading } = useAuth()

  if (!isConfigured) return <NotConfiguredPage />
  if (!ready || meLoading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    )
  }
  if (!session) return <LoginPage />
  if (!me) return <NoAccessPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Suspense fallback={<Spinner />}><OverviewPage /></Suspense>} />
        <Route path="c/:slug" element={<Suspense fallback={<Spinner />}><CoursePage /></Suspense>} />
        <Route path="c/:slug/sessions" element={<SessionsPage />} />
        <Route path="c/:slug/p/:participantId" element={<Suspense fallback={<Spinner />}><ParticipantPage /></Suspense>} />
        <Route path="d/:participantId" element={<Suspense fallback={<Spinner />}><DevoteePage /></Suspense>} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="admin/courses" element={<CoursesAdminPage />} />
        <Route path="admin/courses/:courseId" element={<CourseEditPage />} />
        <Route path="admin/participants" element={<ParticipantsAdminPage />} />
        <Route path="admin/admins" element={me.role === 'super_admin' ? <AdminsPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
