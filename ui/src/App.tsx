import { lazy, Suspense } from 'react';
import { Shell, useHashRoute, type Route } from './app/Shell';
import { I18nProvider } from './i18n';
import { AuthProvider, useAuth } from './auth/AuthContext';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({ default: module.DashboardPage })));
const ProvidersPage = lazy(() => import('./pages/ProvidersPage').then(module => ({ default: module.ProvidersPage })));
const EndpointsPage = lazy(() => import('./pages/EndpointsPage').then(module => ({ default: module.EndpointsPage })));
const RoutingPage = lazy(() => import('./pages/RoutingPage').then(module => ({ default: module.RoutingPage })));
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage').then(module => ({ default: module.PlaygroundPage })));
const StatisticsPage = lazy(() => import('./pages/StatisticsPage').then(module => ({ default: module.StatisticsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })));
const DecisionPage = lazy(() => import('./pages/DecisionPage').then(module => ({ default: module.DecisionPage })));

/**
 * 路由分发：Dashboard / Providers / Entries / Routing DAG / Playground。
 * `/#/` 或 `/#/dashboard`（默认）· `/#/providers` · `/#/endpoints` · `/#/routing` · `/#/playground`
 */
export default function App() {
  const route = useHashRoute();
  return (
    <I18nProvider>
      <AuthProvider>
        <AppContent route={route} />
      </AuthProvider>
    </I18nProvider>
  );
}

function AppContent({ route }: { route: Route }) {
  const { isReadOnly } = useAuth();
  const visibleRoute = isReadOnly && route !== 'start' && route !== 'desk' && route !== 'dashboard' && route !== 'home' && route !== 'playground' && route !== 'stats' && route !== 'settings'
    ? 'dashboard'
    : route;
  return (
      <Shell route={visibleRoute}>
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-[var(--text-muted)]" role="status">{visibleRoute === 'settings' ? 'Loading settings…' : 'Loading…'}</div>}>
        {visibleRoute === 'start' || visibleRoute === 'desk' ? (<DecisionPage desk={visibleRoute === 'desk'} />) : visibleRoute === 'home' || visibleRoute === 'dashboard' ? (
          <DashboardPage />
        ) : visibleRoute === 'providers' ? (
          <ProvidersPage />
        ) : visibleRoute === 'endpoints' ? (
          <EndpointsPage />
        ) : visibleRoute === 'routing' ? (
          <RoutingPage />
        ) : visibleRoute === 'stats' ? (
          <StatisticsPage />
        ) : visibleRoute === 'settings' ? (
          <SettingsPage />
        ) : (
          <PlaygroundPage />
        )}
        </Suspense>
    </Shell>
  );
}
