import { hasProjectRole, type Project, type ProjectRole } from '@ibutest/shared';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Bug,
  ClipboardList,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PlayCircle,
  Server,
  Settings,
  Shield,
  Sun,
  User,
} from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { desktopBridge, isNative, setServerUrl } from '../lib/platform';
import { ErrorAlert, Loading, label } from './ui';

// ------------------------------------------------------------------ theme (per-viewer convenience)
type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'ibutest.theme';

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme = readTheme()) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return (
    <button
      type="button"
      className="btn ghost sm"
      title={`Theme: ${theme}`}
      onClick={() => {
        const t = next[theme];
        setTheme(t);
        try {
          localStorage.setItem(THEME_KEY, t);
        } catch {
          /* ignore */
        }
        applyTheme(t);
      }}
    >
      <Icon size={15} /> {label(theme)}
    </button>
  );
}

// ------------------------------------------------------------------ project context

interface ProjectContextValue {
  project: Project;
  can: (role: ProjectRole) => boolean;
}
const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside a project route');
  return ctx;
}

export function ProjectScope() {
  const { projectId = '' } = useParams();
  const query = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<{ project: Project }>(`/projects/${projectId}`).then((r) => r.project),
  });
  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorAlert error={query.error ?? new Error('Project not found')} />;
  const project = query.data;
  return (
    <ProjectContext.Provider value={{ project, can: (role) => hasProjectRole(project.role, role) && !project.isArchived }}>
      {project.isArchived && (
        <div className="alert warning" style={{ marginBottom: 16 }}>
          This project is archived and read-only.
        </div>
      )}
      <Outlet />
    </ProjectContext.Provider>
  );
}

// ------------------------------------------------------------------ shell

function ProjectNav({ projectId }: { projectId: string }) {
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<{ project: Project }>(`/projects/${projectId}`).then((r) => r.project),
  });
  const base = `/p/${projectId}`;
  const items = [
    { to: base, icon: LayoutDashboard, text: 'Dashboard', end: true },
    { to: `${base}/requirements`, icon: FileText, text: 'Requirements' },
    { to: `${base}/test-cases`, icon: ClipboardList, text: 'Test cases' },
    { to: `${base}/execution`, icon: PlayCircle, text: 'Test execution' },
    { to: `${base}/defects`, icon: Bug, text: 'Defects' },
    { to: `${base}/reports`, icon: BarChart3, text: 'Reports' },
    { to: `${base}/settings`, icon: Settings, text: 'Project settings' },
  ];
  return (
    <>
      {project && (
        <div className="project-chip">
          <span className="badge key">{project.key}</span>
          <strong className="truncate" title={project.name}>
            {project.name}
          </strong>
          <span className="small muted">Role: {label(project.role)}</span>
        </div>
      )}
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <i.icon size={17} aria-hidden /> {i.text}
        </NavLink>
      ))}
    </>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth();
  const { projectId } = useParams();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);
  const desktop = desktopBridge();

  return (
    <div className="app">
      <div className={`scrim${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden />
      <nav className={`sidebar${open ? ' open' : ''}`} aria-label="Main navigation">
        <NavLink to="/" className="brand">
          <img src="/icon.svg" alt="" /> IbuTest
        </NavLink>
        <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <FolderKanban size={17} aria-hidden /> Projects
        </NavLink>
        {projectId && (
          <>
            <div className="nav-section section-title">Project</div>
            <ProjectNav projectId={projectId} />
          </>
        )}
        <div className="nav-section section-title">Account</div>
        <NavLink to="/profile" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <User size={17} aria-hidden /> Profile &amp; security
        </NavLink>
        {user?.role === 'admin' && (
          <NavLink to="/admin" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Shield size={17} aria-hidden /> Administration
          </NavLink>
        )}
        <div className="sidebar-footer stack tight">
          <div className="small">
            <div className="truncate">
              <strong>{user?.name}</strong>
            </div>
            <div className="truncate muted">{user?.email}</div>
          </div>
          <div className="row wrap">
            <ThemeToggle />
            {desktop && (
              <button type="button" className="btn ghost sm" onClick={() => void desktop.openServerSettings()}>
                <Server size={15} /> Server
              </button>
            )}
            {isNative() && (
              <button
                type="button"
                className="btn ghost sm"
                onClick={async () => {
                  await logout();
                  setServerUrl(null);
                  window.location.reload();
                }}
              >
                <Server size={15} /> Server
              </button>
            )}
            <button type="button" className="btn ghost sm" onClick={() => void logout()}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn ghost icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <img src="/icon.svg" alt="" width={24} height={24} />
          <strong>IbuTest</strong>
        </header>
        <main className="content">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
