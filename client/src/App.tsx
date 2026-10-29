import { Navigate, RouterProvider, createBrowserRouter, useLocation } from 'react-router';
import { useAuth } from './auth/AuthProvider';
import { AppLayout, ProjectScope } from './components/Layout';
import { Loading } from './components/ui';
import { getServerUrl, isNative } from './lib/platform';
import { AdminPage } from './pages/admin/AdminPage';
import { ChangePasswordPage, ConnectServerPage, LoginPage, SetupPage } from './pages/AuthPages';
import { ProfilePage } from './pages/ProfilePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { DashboardPage } from './pages/project/DashboardPage';
import { DefectDetailPage, DefectsPage } from './pages/project/DefectsPage';
import { CyclePage, ExecutionPage } from './pages/project/ExecutionPage';
import { ReportsPage } from './pages/project/ReportsPage';
import { RequirementDetailPage, RequirementsPage } from './pages/project/RequirementsPage';
import { RunPage } from './pages/project/RunPage';
import { SettingsPage } from './pages/project/SettingsPage';
import { TestCaseEditorPage } from './pages/project/TestCaseEditor';
import { TestCasesPage } from './pages/project/TestCasesPage';

/** Gate for every authenticated route. */
function RequireAuth() {
  const { ready, user, status, statusError } = useAuth();
  const location = useLocation();
  if (isNative() && !getServerUrl()) return <Navigate to="/connect" replace />;
  if (!ready) return <Loading />;
  if (statusError) return <ConnectServerPage unreachable />;
  if (status?.setupRequired) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword) return <ChangePasswordPage forced />;
  return <AppLayout />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/setup', element: <SetupPage /> },
  { path: '/connect', element: <ConnectServerPage /> },
  {
    element: <RequireAuth />,
    children: [
      { index: true, element: <ProjectsPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'admin', element: <AdminPage /> },
      {
        path: 'p/:projectId',
        element: <ProjectScope />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'requirements', element: <RequirementsPage /> },
          { path: 'requirements/:requirementId', element: <RequirementDetailPage /> },
          { path: 'test-cases', element: <TestCasesPage /> },
          { path: 'test-cases/new', element: <TestCaseEditorPage /> },
          { path: 'test-cases/:testCaseId', element: <TestCaseEditorPage /> },
          { path: 'execution', element: <ExecutionPage /> },
          { path: 'cycles/:cycleId', element: <CyclePage /> },
          { path: 'runs/:runId', element: <RunPage /> },
          { path: 'defects', element: <DefectsPage /> },
          { path: 'defects/:defectId', element: <DefectDetailPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}

