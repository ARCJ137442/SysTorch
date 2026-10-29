import { Archive, ArrowRightToLine, ChevronDown, ListChecks, MoreHorizontal, Pin, Plus, Route, Search, Settings, Trash2, X, type LucideIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { type Task } from '../generated/Task';
import { useI18n, type MessageKey } from '../i18n';
import { SHELL_NAVIGATION, type Route as AppRoute } from '../app/Shell';
import type { StartSessionSummary } from '../generated/StartSessionSummary';
import { hasUnreadReply, orderSessionTasks, sessionQuestion, sessionState, sessionTitle, type StartSessionIndex } from './startSessionIndex';

export const START_ROLE_ITEMS: ReadonlyArray<{ route: AppRoute; labelKey: MessageKey; icon: LucideIcon }> = [
  { route: 'start', labelKey: 'decision.start', icon: ArrowRightToLine },
  { route: 'routing', labelKey: 'decision.coordinate', icon: Route },
  { route: 'desk', labelKey: 'decision.desk', icon: ListChecks },
];

interface StartSessionSidebarProps {
  tasks: readonly Task[];
  sessions: readonly StartSessionSummary[];
  loading: boolean;
  error: string;
  index: StartSessionIndex;
  selectedTaskId: string | null;
  selectedSessionId: string | null;
  showArchived: boolean;
  drawerOpen: boolean;
  onClose: () => void;
  onNewSession: () => void;
  onSelectTask: (task: Task) => void;
  onSelectSession: (session: StartSessionSummary) => void;
  onToggleSessionPinned: (session: StartSessionSummary) => void;
  onArchiveSession: (session: StartSessionSummary) => void;
  onRestoreSession: (session: StartSessionSummary) => void;
  onDeleteSession: (session: StartSessionSummary) => void;
  onToggleArchived: () => void;
  onTogglePinned: (taskId: string) => void;
  onArchive: (taskId: string) => void;
  onRestore: (taskId: string) => void;
  onDelete: (task: Task) => void;
  busyTaskId?: string | null;
  onToggleSort: () => void;
}

function dateGroup(task: Task): 'today' | 'yesterday' | 'last7days' | 'older' {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const created = new Date(task.updated_at * 1000);
  const updatedDay = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime() / 1000;
  const days = Math.floor((today - updatedDay) / 86400);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'last7days';
  return 'older';
}

function sessionDateGroup(updatedAt: number): 'today' | 'yesterday' | 'last7days' | 'older' {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const updated = new Date(updatedAt * 1000);
  const day = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate()).getTime() / 1000;
  const days = Math.floor((today - day) / 86400);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'last7days';
  return 'older';
}

function SessionActions({ task, pinned, archived, busyTaskId, onTogglePinned, onArchive, onRestore, onDelete }: {
  task: Task; pinned: boolean; archived: boolean; busyTaskId?: string | null; onTogglePinned: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const run = (action: () => void) => () => { action(); if (detailsRef.current) detailsRef.current.open = false; };
  return <details className="decision-session-actions" ref={detailsRef}>
    <summary aria-label={t('decision.sessionActions')} title={t('decision.sessionActions')}><MoreHorizontal size={16} aria-hidden="true" /></summary>
    <div className="decision-session-actions__menu">
      <button type="button" onClick={run(onTogglePinned)}><Pin size={14} aria-hidden="true" />{t(pinned ? 'decision.unpinSession' : 'decision.pinSession')}</button>
      {archived
        ? <button type="button" onClick={run(onRestore)}><Archive size={14} aria-hidden="true" />{t('decision.restore')}</button>
        : <button type="button" onClick={run(onArchive)}><Archive size={14} aria-hidden="true" />{t('decision.archive')}</button>}
      <button type="button" className="is-danger" disabled={busyTaskId === task.id} onClick={run(onDelete)}><Trash2 size={14} aria-hidden="true" />{t('decision.deleteSession')}</button>
    </div>
  </details>;
}

function ChatSessionActions({ session, busy, onTogglePinned, onArchive, onRestore, onDelete }: {
  session: StartSessionSummary; busy: boolean; onTogglePinned: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const run = (action: () => void) => () => { action(); if (detailsRef.current) detailsRef.current.open = false; };
  return <details className="decision-session-actions" ref={detailsRef}>
    <summary aria-label={t('decision.sessionActions')} title={t('decision.sessionActions')}><MoreHorizontal size={16} aria-hidden="true" /></summary>
    <div className="decision-session-actions__menu">
      <button type="button" onClick={run(onTogglePinned)}><Pin size={14} aria-hidden="true" />{t(session.pinned ? 'decision.unpinSession' : 'decision.pinSession')}</button>
      {session.archived
        ? <button type="button" onClick={run(onRestore)}><Archive size={14} aria-hidden="true" />{t('decision.restore')}</button>
        : <button type="button" onClick={run(onArchive)}><Archive size={14} aria-hidden="true" />{t('decision.archive')}</button>}
      <button type="button" className="is-danger" disabled={busy} onClick={run(onDelete)}><Trash2 size={14} aria-hidden="true" />{t('decision.deleteSession')}</button>
    </div>
  </details>;
}

export function StartSessionSidebar({ tasks, sessions, loading, error, index, selectedTaskId, selectedSessionId, showArchived, drawerOpen, onClose, onNewSession, onSelectTask, onSelectSession, onToggleSessionPinned, onArchiveSession, onRestoreSession, onDeleteSession, onToggleArchived, onTogglePinned, onArchive, onRestore, onDelete, busyTaskId, onToggleSort }: StartSessionSidebarProps) {
  const { t } = useI18n();
  const { isReadOnly } = useAuth();
  const [query, setQuery] = useState('');
  const visibleSessions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sessions.filter(session => !needle || session.title.toLocaleLowerCase().includes(needle));
  }, [query, sessions]);
  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return orderSessionTasks(tasks, index, showArchived).filter(task => {
      if (!needle) return true;
      const searchable = `${sessionQuestion(task)} ${JSON.stringify(sessionState(task))}`.toLocaleLowerCase();
      return searchable.includes(needle);
    });
  }, [index, query, showArchived, tasks]);
  const pinnedIds = new Set(index.pinnedIds);
  const appItems = SHELL_NAVIGATION.filter(item => item.route !== 'start' && item.route !== 'desk' && item.route !== 'settings' && item.route !== 'routing' && (!isReadOnly || item.route === 'dashboard' || item.route === 'playground' || item.route === 'stats'));
  const pinnedTasks = visibleTasks.filter(task => pinnedIds.has(task.id));
  const pinnedSessions = visibleSessions.filter(session => session.pinned);
  const sessionGroups = (['today', 'yesterday', 'last7days', 'older'] as const).map(key => ({
    key,
    sessions: visibleSessions.filter(session => !session.pinned && sessionDateGroup(session.updated_at) === key),
  })).filter(group => group.sessions.length > 0);
  const dateGroups = (['today', 'yesterday', 'last7days', 'older'] as const).map(key => ({
    key,
    tasks: visibleTasks.filter(task => !pinnedIds.has(task.id) && dateGroup(task) === key),
  })).filter(group => group.tasks.length > 0);
  const renderTask = (task: Task) => {
    const pinned = pinnedIds.has(task.id);
    const archived = index.archivedIds.includes(task.id);
    const unread = hasUnreadReply(task, index);
    return <div className="decision-session-row" key={task.id}>
      <button type="button" className="decision-session-row__open" aria-current={selectedTaskId === task.id ? 'true' : undefined} onClick={() => { onSelectTask(task); onClose(); }}>
        <span className={`decision-session-state decision-session-state--${task.status}`} aria-label={t(`decision.${task.status}` as MessageKey)} />
        <span className="decision-session-row__text"><strong>{sessionTitle(task)}</strong><small>{task.status === 'pending' ? t('decision.pending') : new Date(task.updated_at * 1000).toLocaleString()}</small></span>
        {unread && <span className="decision-session-unread" aria-label={t('decision.unread')} title={t('decision.unread')} />}
      </button>
      <SessionActions
        task={task}
        pinned={pinned}
        archived={archived}
        busyTaskId={busyTaskId}
        onTogglePinned={() => onTogglePinned(task.id)}
        onArchive={() => onArchive(task.id)}
        onRestore={() => onRestore(task.id)}
        onDelete={() => onDelete(task)}
      />
    </div>;
  };
  const renderChatSession = (session: StartSessionSummary) => <div className="decision-session-row" key={session.id}>
    <button type="button" className="decision-session-row__open" aria-current={selectedSessionId === session.id ? 'true' : undefined} onClick={() => { onSelectSession(session); onClose(); }}>
      <span className={`decision-session-state decision-session-state--${session.interrupted ? 'pending' : 'completed'}`} aria-label={session.interrupted ? t('decision.pending') : t('decision.completed')} />
      <span className="decision-session-row__text"><strong>{session.title}</strong><small>{new Date(session.updated_at * 1000).toLocaleString()}</small></span>
      {session.has_unread_reply && <span className="decision-session-unread" aria-label={t('decision.unread')} title={t('decision.unread')} />}
    </button>
    <ChatSessionActions
      session={session}
      busy={busyTaskId === session.id}
      onTogglePinned={() => onToggleSessionPinned(session)}
      onArchive={() => onArchiveSession(session)}
      onRestore={() => onRestoreSession(session)}
      onDelete={() => onDeleteSession(session)}
    />
  </div>;
  return <>
    <button className={`decision-session-backdrop${drawerOpen ? ' is-open' : ''}`} type="button" aria-label={t('decision.closeSessions')} onClick={onClose} />
    <aside className={`decision-session-sidebar${drawerOpen ? ' is-open' : ''}`} aria-label={t('decision.sessions')}>
      <div className="decision-session-app-rail">
        {appItems.map(item => {
          const active = item.route === 'start';
          return <a key={item.route} href={item.href} aria-label={t(item.labelKey)} title={t(item.labelKey)} aria-current={active ? 'page' : undefined} onClick={onClose}>
            <item.icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{t(item.labelKey)}</span>
          </a>;
        })}
      </div>
      <div className="decision-session-list-pane">
        <header className="decision-session-header">
          <strong>{t('decision.sessions')}</strong>
          <div className="decision-session-header__actions">
            <button type="button" className="decision-icon-button" aria-label={t(index.newestFirst ? 'decision.sortNewest' : 'decision.sortOldest')} title={t(index.newestFirst ? 'decision.sortNewest' : 'decision.sortOldest')} onClick={onToggleSort}>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            <button type="button" className="decision-icon-button decision-session-close" aria-label={t('decision.closeSessions')} title={t('decision.closeSessions')} onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        <button type="button" className="decision-new-session" onClick={() => { onNewSession(); onClose(); }}><Plus size={16} aria-hidden="true" />{t('decision.newSession')}</button>
        <label className="decision-session-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('decision.searchSessions')} aria-label={t('decision.searchSessions')} /></label>
        <div className="decision-session-list" aria-busy={loading}>
          {error && <p className="decision-session-error" role="alert">{error}</p>}
          {loading && <p className="decision-session-muted" role="status">{t('decision.loadingSessions')}</p>}
          {pinnedSessions.length > 0 && <section className="decision-session-group"><h2>{t('decision.pinned')}</h2>{pinnedSessions.map(session => renderChatSession(session))}</section>}
          {sessionGroups.map(group => <section className="decision-session-group" key={`chats-${group.key}`}><h2>{t(`decision.${group.key}` as MessageKey)}</h2>{group.sessions.map(session => renderChatSession(session))}</section>)}
          {pinnedTasks.length > 0 && <section className="decision-session-group"><h2>{t('decision.pinned')}</h2>{pinnedTasks.map(renderTask)}</section>}
          {dateGroups.map(group => <section className="decision-session-group" key={group.key}><h2>{t(`decision.${group.key}` as MessageKey)}</h2>{group.tasks.map(renderTask)}</section>)}
          {!loading && visibleTasks.length === 0 && visibleSessions.length === 0 && <p className="decision-session-muted">{showArchived ? t('decision.emptyArchived') : t('decision.emptySessions')}</p>}
        </div>
        <footer className="decision-session-footer">
          <button type="button" className="decision-session-archive-toggle" aria-pressed={showArchived} onClick={onToggleArchived}>
            <Archive size={15} aria-hidden="true" />{t(showArchived ? 'decision.sessions' : 'decision.archived')}
          </button>
          <div className="decision-role-switch" role="group" aria-label={t('decision.workModes')}>
            {START_ROLE_ITEMS.filter(item => !isReadOnly || item.route !== 'routing').map(item => <a key={item.route} href={`#/${item.route}`} aria-label={t(item.labelKey)} title={t(item.labelKey)} aria-current={item.route === 'start' ? 'page' : undefined} onClick={onClose}>
              <item.icon size={17} aria-hidden="true" /><span>{t(item.labelKey)}</span>
            </a>)}
          </div>
          <a className="decision-settings-link" href="#/settings" onClick={onClose}><Settings size={16} aria-hidden="true" />{t('shell.navSettings')}</a>
        </footer>
      </div>
    </aside>
  </>;
}
