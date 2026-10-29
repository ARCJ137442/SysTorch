import { useEffect, useState } from 'react';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { decisionRequest, deleteStartSession, listStartSessions, patchStartSession, type StartSessionSummary } from '../api/decisions';
import type { Task } from '../generated/Task';
import { useI18n } from '../i18n';
import { readStartSessionIndex, sessionTitle, writeStartSessionIndex } from './startSessionIndex';

export function ArchivedSessionsSettings() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chats, setChats] = useState<StartSessionSummary[]>([]);
  const [index, setIndex] = useState(readStartSessionIndex);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      decisionRequest<Task[]>('/decisions?offset=0', undefined, 'GET', controller.signal),
      listStartSessions(0, true, controller.signal),
    ])
      .then(([nextTasks, nextChats]) => { setTasks(nextTasks); setChats(nextChats); })
      .catch(reason => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const archived = tasks.filter(task => index.archivedIds.includes(task.id));
  const restore = (taskId: string) => {
    const next = { ...index, archivedIds: index.archivedIds.filter(id => id !== taskId) };
    setIndex(next);
    writeStartSessionIndex(next);
  };
  const restoreChat = async (chat: StartSessionSummary) => {
    try {
      await patchStartSession(chat.id, { expected_revision: chat.revision, archived: false });
      setChats(current => current.filter(item => item.id !== chat.id));
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const deleteChat = async (chat: StartSessionSummary) => {
    if (!window.confirm(t('decision.deleteSessionConfirm'))) return;
    try {
      await deleteStartSession(chat.id);
      setChats(current => current.filter(item => item.id !== chat.id));
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <div className="grid gap-3">
    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('decision.archivedSessionsHint')}</p>
    {loading && <p role="status" className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('decision.loadingSessions')}</p>}
    {error && <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
    {!loading && !error && archived.length === 0 && chats.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('decision.emptyArchived')}</p>}
    {chats.length > 0 && <section className="grid gap-2">
      <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{t('decision.sessions')}</h3>
      {chats.map(chat => <div key={chat.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b py-2" style={{ borderColor: 'var(--border)' }}>
        <div className="min-w-0"><strong className="block truncate text-sm">{chat.title}</strong><small style={{ color: 'var(--text-muted)' }}>{new Date(chat.updated_at * 1000).toLocaleString()}</small></div>
        <div className="flex items-center gap-2">
          <button type="button" className="inline-flex items-center gap-2 border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text)' }} onClick={() => void restoreChat(chat)}><ArchiveRestore size={15} aria-hidden="true" />{t('decision.restore')}</button>
          <button type="button" className="inline-flex items-center gap-2 border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--danger)' }} onClick={() => void deleteChat(chat)}><Trash2 size={15} aria-hidden="true" />{t('decision.deleteSession')}</button>
        </div>
      </div>)}
    </section>}
    {archived.map(task => <div key={task.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b py-2" style={{ borderColor: 'var(--border)' }}>
      <div className="min-w-0"><strong className="block truncate text-sm">{sessionTitle(task)}</strong><small style={{ color: 'var(--text-muted)' }}>{new Date(task.updated_at * 1000).toLocaleString()}</small></div>
      <button type="button" className="inline-flex items-center gap-2 border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text)' }} onClick={() => restore(task.id)}><ArchiveRestore size={15} aria-hidden="true" />{t('decision.restore')}</button>
    </div>)}
  </div>;
}
