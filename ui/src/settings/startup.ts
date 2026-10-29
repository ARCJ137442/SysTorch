export const STARTUP_PAGE_KEY = 'jev_startup_page';
export const LAST_PAGE_KEY = 'jev_last_page';
export type StartupPage = 'start' | 'dashboard' | 'last';
export function readStartupPage(storage?: Pick<Storage, 'getItem'>): StartupPage {
  try { const value = (storage ?? localStorage).getItem(STARTUP_PAGE_KEY); return value === 'dashboard' || value === 'last' ? value : 'start'; }
  catch { return 'start'; }
}
export function writeStartupPage(page: StartupPage) { try { localStorage.setItem(STARTUP_PAGE_KEY, page); } catch { /* Window remains usable without persistence. */ } }
export function startupRoute(allowed: readonly string[]): string {
  const preference = readStartupPage();
  if (preference !== 'last') return preference;
  try { const last = localStorage.getItem(LAST_PAGE_KEY); return last && allowed.includes(last) ? last : 'start'; }
  catch { return 'start'; }
}
