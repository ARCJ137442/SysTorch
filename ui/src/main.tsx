import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initLang, t } from './i18n';
import './styles/tokens.css';
import './index.css';
import { applyThemePreference, followSystemTheme, readThemePreference } from './theme';
import { applyUiScale, readUiScale } from './settings/preferences';
import { getAndroidGatewayStatus, isAndroidTauri, type AndroidGatewayStatus } from './api/androidGateway';
import { readApiBasePreference, saveApiBasePreference } from './api/base';

/* Resolve the theme before the first render and follow OS changes in system mode. */
applyThemePreference(readThemePreference(), false);
applyUiScale(readUiScale());
followSystemTheme();
/* 语言初始值（块 3）：jev_lang → 默认 en（CDP 断言依赖英文字面）+ <html lang> 同步 */
initLang();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

interface BoundaryProps {
  children: ReactNode;
}
interface BoundaryState {
  error: Error | null;
}

/**
 * Top-level ErrorBoundary — surfaces render-time errors in the DOM instead of
 * silently leaving `<div id="root">` empty. Without this, a downstream render
 * error makes the entire React tree disappear with no on-screen feedback,
 * which is exactly the symptom this app exhibited before this commit.
 */
class RootErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary]', error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      const msg = this.state.error?.message ?? String(this.state.error);
      return (
        <div
          style={{
            padding: 24,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            // design/01 §4 tokens — 崩溃兜底屏也走语义色，不引入屏外色值
            color: 'var(--danger)',
            background: 'var(--panel)',
            border: '1px solid var(--danger)',
            margin: 24,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            SysTorch UI crashed
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{msg}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

async function renderApp() {
  const loading = rootEl?.querySelector('[role="status"]');
  if (loading) loading.textContent = t('decision.loading');
  // Resolve the owned listener before any page fetch, including the new Start
  // page. Never overwrite an explicitly selected external gateway.
  if (isAndroidTauri()) {
    // The first document can load before Android's native invocation handler is
    // ready. An early read may never receive its callback. Retry only this
    // read-only handshake with a bounded deadline; never replay a mutation.
    let status: AndroidGatewayStatus | null = null;
    for (let attempt = 0; attempt < 6 && status === null; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        status = await Promise.race([
          getAndroidGatewayStatus(),
          new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); }),
        ]);
      } catch { /* Native errors do not leave the entire app permanently blank. */ }
      finally { clearTimeout(timer); }
    }
    if (status?.running && status.bind && !readApiBasePreference()) {
      const port = status.bind.slice(status.bind.lastIndexOf(':') + 1);
      try { saveApiBasePreference(`http://127.0.0.1:${port}`); }
      catch { (window as unknown as { __JEV_BASE__: string }).__JEV_BASE__ = `http://127.0.0.1:${port}`; }
    }
  }
  createRoot(rootEl!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
}
void renderApp();
