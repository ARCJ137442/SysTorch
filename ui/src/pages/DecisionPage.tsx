import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Camera, CircleHelp, FilePlus2, ImagePlus, LoaderCircle, Menu, Plus, RefreshCw, Settings, Trash2, X } from 'lucide-react';
import { fetchModels, postSystemOne, SystemOneError, type Answer, type JevRequest, type JevResponse, type Question } from '../api';
import { answerDecision, appendStartSessionMessage, decisionRequest, deleteDecisionAsset, deleteStartSession, fetchStartSessionAsset, fetchTaskAsset, listStartSessions, patchStartSession, readStartSession, setDecisionCredential, submitDecision, type StartMessage, type StartSession, type StartSessionSummary, type Task, type Observation, type RequestAsset, type Submission, DecisionError } from '../api/decisions';
import { useI18n, type MessageKey } from '../i18n';
import type { ModelEntry } from '../generated/ModelEntry';
import { saveJsonFile } from '../api/nativeTransfer';
import { subscribeAuth } from '../auth/callerSession';
import { useAuth } from '../auth/AuthContext';
import { readStartSessionIndex, sessionQuestion, sessionState, writeStartSessionIndex, type StartSessionIndex } from './startSessionIndex';
import { START_ROLE_ITEMS, StartSessionSidebar } from './StartSessionSidebar';
import { assetReferences, buildAssetDescriptors, createDraftAttachments, revokeDraftAttachments, withAssetReferences, type DraftAttachment } from './decisionAssets';
import './decisions.css';

// Unsubmitted sensitive content stays in this window's memory, not localStorage.
const composer = { question: '', context: '', choices: '', questionType: 'choice' as Question['type'], entry: 'human:owner', taskId: '' };
const composerAttachments: { context: DraftAttachment[]; question: DraftAttachment[] } = { context: [], question: [] };
const submissionIdentity = { key: '', snapshot: '' };
interface AnswerDraft { choice: string; note: string; conditional: boolean; questionChoices: Record<string, string>; boxes: Record<string, { top: string; bottom: string; left: string; right: string }> }
const drafts = new Map<string, AnswerDraft>();
interface DecisionQuestionView { id: string; question: string; type: Question['type']; choices: Array<{ id: string; label: string }>; assetReferences: string[] }
interface QueuedDecisionQuestion extends DecisionQuestionView { assets: DraftAttachment[] }
const queuedQuestions: QueuedDecisionQuestion[] = [];
let questionIdSequence = 0;
let selectedId = '';

function contextValue(text: string) { try { return JSON.parse(text); } catch { return text; } }
function taskLink(id: string) { return `#/desk?task=${encodeURIComponent(id)}`; }
function newChatId(prefix: 'start' | 'msg'): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${random}`;
}
async function appendChatMessage(sessionId: string, expectedRevision: number, message: StartMessage): Promise<StartSession> {
  let revision = expectedRevision;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await appendStartSessionMessage(sessionId, { expected_revision: revision, message });
    } catch (error) {
      lastError = error;
      if (error instanceof DecisionError && error.status !== 409) throw error;
      const recovered = await readStartSession(sessionId).catch(() => null);
      if (!recovered) {
        if (revision !== 0) throw error;
        continue;
      }
      const prior = recovered.messages.find(existing => existing.id === message.id);
      if (prior) {
        if (JSON.stringify(prior) === JSON.stringify(message)) return recovered;
        throw new DecisionError('message_id_conflict', 409, 'The chat contains another message with this ID. Start a new message before retrying.');
      }
      revision = recovered.summary.revision;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not append the chat message.');
}
function errorMessage(error: unknown, t: (key: MessageKey) => string): string {
  if (!(error instanceof DecisionError)) return error instanceof Error ? error.message : t('decision.offline');
  const key: MessageKey = error.code === 'decision_native_identity_unavailable' ? 'decision.errorNative' : error.status === 401 ? 'decision.errorAuth' : error.status === 403 || error.status === 404 ? 'decision.errorDenied' : error.status === 409 ? 'decision.errorConflict' : error.status === 410 ? 'decision.errorErased' : error.status >= 500 ? 'decision.errorStorage' : 'decision.errorInvalid';
  return `${t(key)} [${error.code}]`;
}

function releaseDraftAttachments(attachments: readonly DraftAttachment[]): void {
  revokeDraftAttachments(attachments);
  for (const attachment of attachments) {
    if (attachment.uploadedAssetId) void deleteDecisionAsset(attachment.uploadedAssetId).catch(() => {});
  }
}

function releaseAllComposerAttachments(): void {
  const attachments = [
    ...composerAttachments.context,
    ...composerAttachments.question,
    ...queuedQuestions.flatMap(question => question.assets),
  ];
  releaseDraftAttachments(attachments);
  composerAttachments.context = [];
  composerAttachments.question = [];
  queuedQuestions.splice(0);
}

function answerLabel(answer: Answer | undefined, question: DecisionQuestionView): string {
  if (!answer) return '—';
  if (answer.type === 'choice') return question.choices.find(choice => choice.id === answer.choice)?.label ?? answer.choice;
  if (answer.type === 'score') {
    const level = Number.isInteger(answer.score) ? question.choices[answer.score]?.label : undefined;
    return level ? `${level} · ${answer.score}` : String(answer.score);
  }
  if (answer.type === 'noul' || answer.type === 'boolean') {
    const probability = answer.probability ?? answer.noul;
    if (probability === null || probability === undefined) return '—';
    return question.choices.find(choice => choice.id === String(probability >= 0.5))?.label ?? String(probability);
  }
  if (answer.type === 'box') return `top ${answer.box.top} · bottom ${answer.box.bottom} · left ${answer.box.left} · right ${answer.box.right}`;
  return '—';
}

function instructionText(instructions: unknown): string {
  if (typeof instructions === 'string') return instructions;
  if (instructions && typeof instructions === 'object' && 'text' in instructions && typeof instructions.text === 'string') return instructions.text;
  return JSON.stringify(instructions ?? '');
}

function contextTextForDisplay(context: unknown): string {
  if (typeof context === 'string') return context;
  if (context && typeof context === 'object' && !Array.isArray(context) && '_systorch' in context) {
    const { _systorch: _internal, ...visible } = context as Record<string, unknown>;
    if (Object.keys(visible).length === 1 && typeof visible.text === 'string') return visible.text;
    return JSON.stringify(visible, null, 2);
  }
  return JSON.stringify(context, null, 2);
}

function taskQuestions(task: Task): DecisionQuestionView[] {
  const knownAssets = new Set(Object.keys(task.request.assets ?? {}));
  const questions = task.request.questions;
  if (!questions) return [{ id: 'choice', question: task.request.question ?? '', type: 'choice', choices: task.request.choices ?? [], assetReferences: [] }];
  const ids = task.request.question_order?.filter(id => id in questions) ?? Object.keys(questions).sort();
  return ids.map(id => {
    const question = questions[id];
    const choices = question.type === 'choice'
      ? Object.entries(question.criteria).map(([choiceId, label]) => ({ id: choiceId, label: criterionText(label, choiceId) }))
      : question.type === 'score'
        ? question.criteria.map((level, index) => ({ id: String(index), label: criterionText(level, String(index)) }))
        : question.type === 'noul'
          ? [
            { id: 'true', label: criterionText(question.criteria?.true, '是 / 符合') },
            { id: 'false', label: criterionText(question.criteria?.false, '否 / 不符合') },
          ]
          : [];
    return {
      id,
      question: instructionText(question.instructions),
      type: question.type,
      choices,
      assetReferences: assetReferences(question.instructions, knownAssets),
    };
  });
}

function directRequestQuestions(request: JevRequest, order?: readonly string[]): DecisionQuestionView[] {
  const knownAssets = new Set(Object.keys(request.assets ?? {}));
  const orderedIds = order?.filter(id => id in request.questions) ?? Object.keys(request.questions).sort();
  return orderedIds.map(id => {
    const question = request.questions[id];
    const choices = question.type === 'choice'
      ? Object.entries(question.criteria).map(([choiceId, label]) => ({ id: choiceId, label: criterionText(label, choiceId) }))
      : question.type === 'score'
        ? question.criteria.map((level, index) => ({ id: String(index), label: criterionText(level, String(index)) }))
        : question.type === 'noul'
          ? [
            { id: 'true', label: criterionText(question.criteria?.true, 'Yes / true') },
            { id: 'false', label: criterionText(question.criteria?.false, 'No / false') },
          ]
          : [];
    return { id, question: instructionText(question.instructions), type: question.type, choices, assetReferences: assetReferences(question.instructions, knownAssets) };
  });
}

function protocolQuestion(question: QueuedDecisionQuestion, instructions: Question['instructions']): Question {
  switch (question.type) {
    case 'choice':
      return { type: 'choice', instructions, criteria: Object.fromEntries(question.choices.map(choice => [choice.id, choice.label])) };
    case 'score':
      return { type: 'score', instructions, criteria: question.choices.map(level => level.label) };
    case 'noul':
      return { type: 'noul', instructions, criteria: { true: question.choices[0]?.label ?? '是 / 符合', false: question.choices[1]?.label ?? '否 / 不符合' } };
    case 'box':
      return { type: 'box', instructions };
  }
}

function criterionText(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  return instructionText(value);
}

function observationLabel(question: DecisionQuestionView, observation: Observation): string | null {
  if (observation.kind === 'answered' || observation.kind === 'conditional') {
    return question.choices.find(choice => choice.id === observation.choice_id)?.label ?? observation.choice_id;
  }
  if (observation.kind === 'noul') {
    return question.choices.find(choice => choice.id === String(observation.value))?.label ?? String(observation.value);
  }
  if (observation.kind === 'score') {
    return question.choices[observation.level_index]?.label ?? String(observation.level_index);
  }
  if (observation.kind === 'box') {
    return `top ${observation.top} · bottom ${observation.bottom} · left ${observation.left} · right ${observation.right}`;
  }
  return null;
}

function taskObservations(task: Task): Record<string, Observation> {
  const observations = { ...(task.observations ?? {}) };
  if (!task.request.questions && task.observation) observations.choice = task.observation;
  return observations;
}

function IdentityGate({ connected }: { connected: () => void }) {
  const { t } = useI18n();
  const auth = useAuth();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(false);
  return <form className="decision-auth" onSubmit={event => {
    event.preventDefault(); if (gate.current) return; gate.current = true; setBusy(true); setError('');
    void (async () => {
      try {
        if (value.trim().startsWith('st_owner_')) { auth.logoutCaller(); setDecisionCredential(value); }
        else { await auth.loginCaller(value); setDecisionCredential(''); }
        setValue(''); connected();
      } catch (e) { setError(errorMessage(e, t)); }
      finally { gate.current = false; setBusy(false); }
    })();
  }}>
    <p>{t('decision.auth')}</p>
    <label>{t('decision.token')}<input aria-label={t('decision.token')} type="password" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} disabled={busy} required /></label>
    <button type="submit" disabled={busy}>{t(busy ? 'decision.loading' : 'decision.connect')}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function DecisionPage({ desk = false }: { desk?: boolean }) {
  const { t } = useI18n();
  const [identity, setIdentity] = useState<{ id: string; can_answer: boolean } | null>(null);
  const [authError, setAuthError] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let live = true;
    decisionRequest<{ id: string; can_answer: boolean }>('/identity').then(v => { if (live) { setIdentity(v); setAuthError(false); setConnectionError(''); } }).catch(e => { if (live) { setAuthError(true); setConnectionError(errorMessage(e, t)); } });
    const reset = () => {
      setIdentity(null); setGeneration(v => v + 1); drafts.clear(); selectedId = '';
      releaseAllComposerAttachments(); questionIdSequence = 0;
      Object.assign(composer, { question: '', context: '', choices: '', questionType: 'choice', entry: 'human:owner', taskId: '' });
      Object.assign(submissionIdentity, { key: '', snapshot: '' });
    };
    window.addEventListener('jev-api-base-change', reset);
    window.addEventListener('decision-credential-change', reset);
    const unsubscribe = subscribeAuth(reset);
    return () => { live = false; unsubscribe(); window.removeEventListener('jev-api-base-change', reset); window.removeEventListener('decision-credential-change', reset); };
  }, [generation, t]);
  return <section className={`decision-workspace${desk ? ' decision-workspace--desk' : ' decision-workspace--start'}`}>
    {desk ? <>
      <header className="decision-heading"><div><small>SysTorch · {t('decision.preview')}</small><h1>{t('decision.desk')}</h1></div>
        <span className="decision-identity">{identity ? t(identity.can_answer ? 'decision.owner' : 'decision.caller') : '…'}</span></header>
      {authError && <IdentityGate connected={() => setGeneration(v => v + 1)} />}
      {connectionError && <div><p className="decision-error" role="alert">{connectionError}</p><button type="button" onClick={() => setGeneration(v => v + 1)}>{t('decision.refresh')}</button></div>}
      {identity && <Desk identity={identity} />}
      <footer className="decision-privacy">{t('decision.privacy')}</footer>
    </> : <Start
      key={`${generation}/${identity?.id ?? ''}`}
      ready={Boolean(identity)}
      authError={authError}
      connectionError={connectionError}
      onIdentityConnected={() => setGeneration(v => v + 1)}
      onRefresh={() => setGeneration(v => v + 1)}
    />}
  </section>;
}

function Start({ ready, authError, connectionError, onIdentityConnected, onRefresh }: { ready: boolean; authError: boolean; connectionError: string; onIdentityConnected: () => void; onRefresh: () => void }) {
  const { t } = useI18n();
  const { isReadOnly } = useAuth();
  const [draft, setDraft] = useState({ ...composer });
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<JevResponse | null>(null);
  const [receipt, setReceipt] = useState<Task | null>(null);
  const [submittedQuestions, setSubmittedQuestions] = useState<QueuedDecisionQuestion[]>([]);
  const [submittedContext, setSubmittedContext] = useState('');
  const [submittedAttachments, setSubmittedAttachments] = useState<DraftAttachment[]>([]);
  const [submittedContextAttachments, setSubmittedContextAttachments] = useState<DraftAttachment[]>([]);
  const [, setQueueRevision] = useState(0);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const contextDetailsRef = useRef<HTMLDetailsElement>(null);
  const contextFilesRef = useRef<HTMLInputElement>(null);
  const contextCameraRef = useRef<HTMLInputElement>(null);
  const contextFilePickerRef = useRef<HTMLInputElement>(null);
  const questionFilesRef = useRef<HTMLInputElement>(null);
  const questionCameraRef = useRef<HTMLInputElement>(null);
  const questionFilePickerRef = useRef<HTMLInputElement>(null);
  const [contextAttachments, setContextAttachments] = useState<DraftAttachment[]>(() => [...composerAttachments.context]);
  const [questionAttachments, setQuestionAttachments] = useState<DraftAttachment[]>(() => [...composerAttachments.question]);
  const submittedAttachmentsRef = useRef(submittedAttachments);
  useEffect(() => { submittedAttachmentsRef.current = submittedAttachments; }, [submittedAttachments]);
  useEffect(() => () => revokeDraftAttachments(submittedAttachmentsRef.current), []);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState('');
  const [sessions, setSessions] = useState<StartSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState('');
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);
  const [sessionIndex, setSessionIndex] = useState<StartSessionIndex>(readStartSessionIndex);
  const sessionIndexRef = useRef(sessionIndex);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<StartSession | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find(task => task.id === selectedTaskId) ?? null;
  const chatThreadRef = useRef<HTMLDivElement>(null);
  const followLatestReply = useRef(false);
  useLayoutEffect(() => {
    if (!followLatestReply.current) return;
    const thread = chatThreadRef.current;
    if (!thread) return;
    const openDeskLink = thread.querySelector<HTMLAnchorElement>('a[href^="#/desk?task="]');
    if (openDeskLink) openDeskLink.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    else thread.scrollTop = thread.scrollHeight;
    followLatestReply.current = false;
  }, [receipt, result, selectedSession, selectedTask, selectedTaskId]);
  const suppliedOptions = draft.choices.split('\n').map(value => value.trim()).filter(Boolean);
  const choiceLabels = draft.questionType === 'noul' && suppliedOptions.length === 0 ? [t('decision.noulYes'), t('decision.noulNo')] : suppliedOptions;
  const draftHasContent = Boolean(draft.question.trim() || draft.choices.trim() || questionAttachments.length);
  const distinctOptions = new Set(choiceLabels).size === choiceLabels.length;
  const hasBoxImage = [...contextAttachments, ...questionAttachments].some(attachment => attachment.file.type.startsWith('image/'));
  const draftValid = Boolean(draft.question.trim()) && (draft.questionType === 'box'
    ? hasBoxImage
    : (draft.questionType === 'noul' && (suppliedOptions.length === 0 || suppliedOptions.length === 2) && distinctOptions)
    || (draft.questionType === 'score' && choiceLabels.length >= 2 && choiceLabels.length <= 10 && distinctOptions)
    || (draft.questionType === 'choice' && choiceLabels.length >= 2 && choiceLabels.length <= 255 && distinctOptions));
  const pendingCount = queuedQuestions.length + (draftValid ? 1 : 0);
  const queuedForRender = [...queuedQuestions];
  const incompleteDraft = draftHasContent && !draftValid;
  const canSend = !busy && pendingCount > 0 && !incompleteDraft && (draft.entry !== 'human:owner' || ready) && (!selectedSessionId || Boolean(selectedSession));

  useEffect(() => { let live = true; fetchModels().then(v => { if (live) setModels(v.data); }).catch(() => {}); return () => { live = false; }; }, []);
  useEffect(() => {
    if (!ready) { setTasksLoading(false); return; }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const sync = async () => {
      try {
        const next = await decisionRequest<Task[]>('/decisions?offset=0', undefined, 'GET', controller.signal);
        if (live) { setTasks(next); setTasksError(''); }
      } catch (e) {
        if (live && !(e instanceof DOMException && e.name === 'AbortError')) setTasksError(errorMessage(e, t));
      } finally {
        if (live) {
          setTasksLoading(false);
          timer = setTimeout(() => { if (document.visibilityState === 'visible') void sync(); else timer = setTimeout(() => void sync(), 5000); }, 5000);
        }
      }
    };
    setTasksLoading(true);
    void sync();
    return () => { live = false; controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [ready, taskRefresh, t]);

  useEffect(() => {
    if (!ready) { setSessionsLoading(false); return; }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const sync = async () => {
      try {
        const next = await listStartSessions(0, showArchivedSessions, controller.signal);
        if (live) { setSessions(next); setSessionsError(''); }
      } catch (e) {
        if (live && !(e instanceof DOMException && e.name === 'AbortError')) setSessionsError(errorMessage(e, t));
      } finally {
        if (live) {
          setSessionsLoading(false);
          timer = setTimeout(() => { if (document.visibilityState === 'visible') void sync(); else timer = setTimeout(() => void sync(), 5000); }, 5000);
        }
      }
    };
    setSessionsLoading(true);
    void sync();
    return () => { live = false; controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [ready, showArchivedSessions, taskRefresh, t]);

  const updateSessionIndex = (update: (current: StartSessionIndex) => StartSessionIndex) => {
    const next = update(sessionIndexRef.current);
    sessionIndexRef.current = next;
    setSessionIndex(next);
    writeStartSessionIndex(next);
  };
  useEffect(() => {
    if (!selectedTaskId) return;
    const task = tasks.find(item => item.id === selectedTaskId);
    if (!task || (task.status !== 'completed' && !Object.keys(task.observations ?? {}).length && !task.observation) || (sessionIndex.lastReadAt[task.id] ?? 0) >= task.updated_at) return;
    updateSessionIndex(current => ({ ...current, lastReadAt: { ...current.lastReadAt, [task.id]: task.updated_at } }));
  }, [selectedTaskId, sessionIndex.lastReadAt, tasks]);
  const openTask = (task: Task) => {
    followLatestReply.current = true;
    setSelectedTaskId(task.id);
    setSelectedSessionId(null); setSelectedSession(null);
    setResult(null); setReceipt(null); setSubmittedQuestions([]); setSubmittedContext('');
    updateSessionIndex(current => ({ ...current, lastReadAt: { ...current.lastReadAt, [task.id]: Math.floor(Date.now() / 1000) } }));
  };
  const startNewSession = () => {
    setSelectedTaskId(null); setSelectedSessionId(null); setSelectedSession(null); setSubmittedQuestions([]); setSubmittedContext(''); setResult(null); setReceipt(null); setError('');
    releaseAllComposerAttachments(); setContextAttachments([]); setQuestionAttachments([]); releaseDraftAttachments(submittedAttachments); setSubmittedAttachments([]); setSubmittedContextAttachments([]); setQueueRevision(value => value + 1);
    Object.assign(submissionIdentity, { key: '', snapshot: '' });
    setDraft({ question: '', context: '', choices: '', questionType: 'choice', entry: 'human:owner', taskId: '' });
    Object.assign(composer, { question: '', context: '', choices: '', questionType: 'choice', entry: 'human:owner', taskId: '' });
  };
  const openChatSession = async (summary: StartSessionSummary) => {
    followLatestReply.current = true;
    setSelectedTaskId(null); setSelectedSessionId(summary.id); setSelectedSession(null);
    setResult(null); setReceipt(null); setError('');
    try {
      let session = await readStartSession(summary.id);
      if (session.summary.has_unread_reply) session = await patchStartSession(summary.id, { expected_revision: session.summary.revision, mark_read: true });
      setSelectedSession(session);
      setSessions(current => current.map(item => item.id === session.summary.id ? session.summary : item));
    } catch (e) { setSelectedSessionId(null); setError(errorMessage(e, t)); }
  };
  const markChatRead = async (session: StartSession): Promise<StartSession> => {
    if (!session.summary.has_unread_reply) return session;
    try {
      return await patchStartSession(session.summary.id, { expected_revision: session.summary.revision, mark_read: true });
    } catch (error) {
      setSessionsError(errorMessage(error, t));
      return session;
    }
  };
  const retryInterruptedSession = async (session: StartSession) => {
    if (gate.current || !session.summary.interrupted) return;
    const replied = new Set(session.messages.flatMap(message => message.kind === 'response' || message.kind === 'failure' ? [message.reply_to] : []));
    const pending = [...session.messages].reverse().find((message): message is Extract<StartMessage, { kind: 'request' }> => message.kind === 'request' && !replied.has(message.id));
    if (!pending) return;
    gate.current = true; setBusy(true); setError('');
    try {
      const response = await postSystemOne(pending.request);
      const reply: StartMessage = { kind: 'response', id: newChatId('msg'), created_at: Math.floor(Date.now() / 1000), reply_to: pending.id, response };
      const appended = await appendChatMessage(session.summary.id, session.summary.revision, reply);
      const updated = await markChatRead(appended);
      followLatestReply.current = true;
      setSelectedSession(updated);
      setSessions(current => [...current.filter(item => item.id !== updated.summary.id), ...(updated.summary.archived === showArchivedSessions ? [updated.summary] : [])]);
    } catch (requestError) {
      const failure: StartMessage = {
        kind: 'failure', id: newChatId('msg'), created_at: Math.floor(Date.now() / 1000), reply_to: pending.id,
        error_code: requestError instanceof SystemOneError ? `http_${requestError.status}` : 'request_failed',
        status: requestError instanceof SystemOneError ? requestError.status : null,
        retryable: requestError instanceof SystemOneError ? requestError.retryable : false,
        request_id: requestError instanceof SystemOneError ? requestError.requestId : null,
      };
      try {
        const appended = await appendChatMessage(session.summary.id, session.summary.revision, failure);
        const updated = await markChatRead(appended);
        followLatestReply.current = true;
        setSelectedSession(updated);
        setSessions(current => [...current.filter(item => item.id !== updated.summary.id), ...(updated.summary.archived === showArchivedSessions ? [updated.summary] : [])]);
      } catch (saveError) { setSessionsError(errorMessage(saveError, t)); }
      setError(errorMessage(requestError, t));
    } finally { gate.current = false; setBusy(false); }
  };
  const mutateChatSession = async (session: StartSessionSummary, patch: { pinned?: boolean; archived?: boolean }) => {
    setBusyTaskId(session.id); setSessionsError('');
    try {
      const updated = await patchStartSession(session.id, { expected_revision: session.revision, ...patch });
      if (selectedSessionId === session.id) setSelectedSession(updated);
      setSessions(current => [...current.filter(item => item.id !== session.id), ...(updated.summary.archived === showArchivedSessions ? [updated.summary] : [])]);
    } catch (e) { setSessionsError(errorMessage(e, t)); }
    finally { setBusyTaskId(null); }
  };
  const deleteChatSession = async (session: StartSessionSummary) => {
    if (!window.confirm(t('decision.deleteTaskConfirm'))) return;
    setBusyTaskId(session.id); setSessionsError('');
    try {
      await deleteStartSession(session.id);
      setSessions(current => current.filter(item => item.id !== session.id));
      if (selectedSessionId === session.id) { setSelectedSessionId(null); setSelectedSession(null); }
    } catch (e) { setSessionsError(errorMessage(e, t)); }
    finally { setBusyTaskId(null); }
  };
  const deleteTask = async (task: Task) => {
    if (!window.confirm(t('decision.deleteSessionConfirm'))) return;
    setBusyTaskId(task.id); setTasksError('');
    let cancelled = false;
    try {
      if (task.status === 'pending') { await decisionRequest(`/decisions/${encodeURIComponent(task.id)}/cancel`, {}); cancelled = true; }
      await decisionRequest(`/decisions/${encodeURIComponent(task.id)}`, undefined, 'DELETE');
      if (selectedTaskId === task.id) setSelectedTaskId(null);
      updateSessionIndex(current => ({ ...current, pinnedIds: current.pinnedIds.filter(id => id !== task.id), archivedIds: current.archivedIds.filter(id => id !== task.id), lastReadAt: Object.fromEntries(Object.entries(current.lastReadAt).filter(([id]) => id !== task.id)) }));
      setTasks(current => current.filter(item => item.id !== task.id));
      setTasksError('');
    } catch (e) {
      setTasksError(cancelled ? `${t('decision.sessionDeletePartial')} ${errorMessage(e, t)}` : errorMessage(e, t));
      setTaskRefresh(value => value + 1);
    } finally { setBusyTaskId(null); }
  };
  const change = (patch: Partial<typeof composer>) => setDraft(current => { const next = { ...current, ...patch }; Object.assign(composer, next); return next; });
  const snapshotDraftQuestion = (): QueuedDecisionQuestion => ({
    id: `question-${Date.now().toString(36)}-${(++questionIdSequence).toString(36)}`,
    question: draft.question.trim(),
    type: draft.questionType,
    choices: draft.questionType === 'choice'
      ? choiceLabels.map((label, index) => ({ id: `option${index + 1}`, label }))
      : draft.questionType === 'score'
        ? choiceLabels.map((label, index) => ({ id: String(index), label }))
        : draft.questionType === 'noul'
          ? [{ id: 'true', label: choiceLabels[0] }, { id: 'false', label: choiceLabels[1] }]
          : [],
    assets: [...composerAttachments.question],
    assetReferences: composerAttachments.question.map(attachment => attachment.reference),
  });
  const appendAttachments = (scope: 'context' | 'question', files: FileList | readonly File[]) => {
    const incoming = createDraftAttachments(files);
    const current = scope === 'context' ? composerAttachments.context : composerAttachments.question;
    const queued = queuedQuestions.reduce((count, question) => count + question.assets.length, 0);
    if (composerAttachments.context.length + composerAttachments.question.length + queued + incoming.length > 128) {
      releaseDraftAttachments(incoming);
      setError(t('decision.assetCountLimit'));
      return;
    }
    const next = [...current, ...incoming];
    if (scope === 'context') { composerAttachments.context = next; setContextAttachments(next); }
    else { composerAttachments.question = next; setQuestionAttachments(next); }
    setError('');
  };
  const removeAttachment = (scope: 'context' | 'question', reference: string) => {
    const current = scope === 'context' ? composerAttachments.context : composerAttachments.question;
    const removed = current.find(attachment => attachment.reference === reference);
    const next = current.filter(attachment => attachment.reference !== reference);
    if (removed) releaseDraftAttachments([removed]);
    if (scope === 'context') { composerAttachments.context = next; setContextAttachments(next); }
    else { composerAttachments.question = next; setQuestionAttachments(next); }
  };
  const pasteAttachments = (scope: 'context' | 'question', event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    const target = event.currentTarget;
    const text = event.clipboardData.getData('text/plain');
    if (text) {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
      if (scope === 'context') change({ context: next }); else change({ question: next });
      window.requestAnimationFrame(() => target.setSelectionRange(start + text.length, start + text.length));
    }
    appendAttachments(scope, files);
  };
  const addQuestionToQueue = () => {
    if (!draftValid || busy) { setError(t('decision.invalid')); return; }
    queuedQuestions.push(snapshotDraftQuestion());
    setQueueRevision(value => value + 1);
    setError('');
    composerAttachments.question = [];
    setQuestionAttachments([]);
    change({ question: '', choices: '' });
    window.requestAnimationFrame(() => questionInputRef.current?.focus());
  };
  const moveQueuedQuestion = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= queuedQuestions.length) return;
    const [question] = queuedQuestions.splice(index, 1);
    queuedQuestions.splice(nextIndex, 0, question);
    setQueueRevision(value => value + 1);
  };
  const removeQueuedQuestion = (index: number) => {
    const [removed] = queuedQuestions.splice(index, 1);
    if (removed) releaseDraftAttachments(removed.assets);
    setQueueRevision(value => value + 1);
  };
  const clearSubmittedDraft = (taskId = '') => {
    change({ question: '', context: '', choices: '', taskId });
    if (contextDetailsRef.current) contextDetailsRef.current.open = false;
  };
  const submit = async () => {
    if (gate.current) return;
    if (draftHasContent && !draftValid) { setError(t('decision.invalid')); return; }
    const outgoingQuestions = [...queuedForRender, ...(draftValid ? [snapshotDraftQuestion()] : [])];
    if (!outgoingQuestions.length) { setError(t('decision.invalid')); return; }
    gate.current = true; setBusy(true); setError(''); setReceipt(null); setResult(null); setSelectedTaskId(null);
    releaseDraftAttachments(submittedAttachments);
    setSubmittedAttachments([]);
    setSubmittedContextAttachments([]);
    setSubmittedQuestions(outgoingQuestions); setSubmittedContext(draft.context);
    try {
      const attachments = [...composerAttachments.context, ...outgoingQuestions.flatMap(question => question.assets)];
      // Persisted chats and durable tasks use encrypted asset IDs for every attachment.
      const assetDescriptors = await buildAssetDescriptors(attachments, undefined, undefined, 0);
      const assetMap = Object.keys(assetDescriptors).length ? assetDescriptors : undefined;
      const sharedContext = withAssetReferences(
        contextValue(draft.context),
        composerAttachments.context.map(attachment => attachment.reference),
      );
      const questionInstructions = (question: QueuedDecisionQuestion) => withAssetReferences(
        question.question,
        question.assets.map(attachment => attachment.reference),
      );
      const choices = outgoingQuestions[0].type === 'choice' ? outgoingQuestions[0].choices : [];
      if (draft.entry === 'human:owner') {
        setSelectedSessionId(null); setSelectedSession(null);
        const questions: NonNullable<Submission['questions']> = Object.fromEntries(outgoingQuestions.map(question => [question.id, protocolQuestion(question, questionInstructions(question) as Question['instructions'])]));
        const questionOrder = outgoingQuestions.map(question => question.id);
        const attachmentIdentity = attachments.map(({ reference, file }) => ({ reference, name: file.name, size: file.size, type: file.type, modified: file.lastModified }));
        const snapshot = JSON.stringify({ question: outgoingQuestions[0].question, context: draft.context, choices, questionOrder, questions, attachmentIdentity, entry: draft.entry });
        const key = submissionIdentity.snapshot === snapshot && submissionIdentity.key ? submissionIdentity.key : Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
        Object.assign(submissionIdentity, { key, snapshot });
        const body: Submission = { model: 'human:owner', state: sharedContext, entry: draft.entry, idempotency_key: key, questions, question_order: questionOrder, ...(assetMap ? { assets: assetMap } : {}), ttl_seconds: 86400 };
        const task = await submitDecision(body);
        followLatestReply.current = true;
        setReceipt(task); setTasks(current => [task, ...current.filter(existing => existing.id !== task.id)]); setSelectedTaskId(task.id); setTaskRefresh(value => value + 1); queuedQuestions.splice(0); setQueueRevision(value => value + 1); clearSubmittedDraft(task.id);
        composerAttachments.context = []; composerAttachments.question = [];
        setContextAttachments([]); setQuestionAttachments([]);
        revokeDraftAttachments(attachments);
      } else {
        const questions: Record<string, Question> = Object.fromEntries(outgoingQuestions.map(question => [question.id, protocolQuestion(question, questionInstructions(question) as Question['instructions'])]));
        const request: JevRequest = { model: draft.entry.slice('model:'.length), state: sharedContext, questions, ...(assetMap ? { assets: assetMap } : {}) };
        const sessionId = selectedSessionId ?? newChatId('start');
        const requestMessageId = newChatId('msg');
        const requestMessage: StartMessage = {
          kind: 'request', id: requestMessageId, created_at: Math.floor(Date.now() / 1000), request, question_order: outgoingQuestions.map(question => question.id),
        };
        const storedRequest = await appendChatMessage(sessionId, selectedSession?.summary.revision ?? 0, requestMessage);
        setSelectedSessionId(sessionId); setSelectedSession(storedRequest);
        setSessions(current => [...current.filter(item => item.id !== sessionId), ...(storedRequest.summary.archived === showArchivedSessions ? [storedRequest.summary] : [])]);
        queuedQuestions.splice(0); setQueueRevision(value => value + 1);
        composerAttachments.context = []; composerAttachments.question = [];
        setContextAttachments([]); setQuestionAttachments([]);
        revokeDraftAttachments(attachments);
        clearSubmittedDraft();
        followLatestReply.current = true;
        let response: JevResponse;
        try {
          response = await postSystemOne(request);
        } catch (providerError) {
          const failureMessage: StartMessage = {
            kind: 'failure', id: newChatId('msg'), created_at: Math.floor(Date.now() / 1000), reply_to: requestMessageId,
            error_code: providerError instanceof SystemOneError ? `http_${providerError.status}` : 'request_failed',
            status: providerError instanceof SystemOneError ? providerError.status : null,
            retryable: providerError instanceof SystemOneError ? providerError.retryable : false,
            request_id: providerError instanceof SystemOneError ? providerError.requestId : null,
          };
          try {
            const appended = await appendChatMessage(sessionId, storedRequest.summary.revision, failureMessage);
            const failed = await markChatRead(appended);
            followLatestReply.current = true;
            setSelectedSession(failed);
            setSessions(current => [...current.filter(item => item.id !== sessionId), ...(failed.summary.archived === showArchivedSessions ? [failed.summary] : [])]);
          } catch (saveError) { setSessionsError(errorMessage(saveError, t)); }
          setError(errorMessage(providerError, t));
          return;
        }
        const responseMessage: StartMessage = {
          kind: 'response', id: newChatId('msg'), created_at: Math.floor(Date.now() / 1000), reply_to: requestMessageId, response,
        };
        try {
          const appended = await appendChatMessage(sessionId, storedRequest.summary.revision, responseMessage);
          const completed = await markChatRead(appended);
          followLatestReply.current = true;
          setSelectedSession(completed); setResult(null);
          setSessions(current => [...current.filter(item => item.id !== sessionId), ...(completed.summary.archived === showArchivedSessions ? [completed.summary] : [])]);
        } catch (saveError) {
          // Keep the actual model response visible even if the encrypted history write cannot be retried.
          followLatestReply.current = true;
          setResult(response);
          setSessionsError(`${t('decision.sessionReplyNotSaved')} ${errorMessage(saveError, t)}`);
        }
      }
    } catch (e) { setError(errorMessage(e, t)); }
    finally { gate.current = false; setBusy(false); }
  };
  return <div className="decision-start-layout">
    <StartSessionSidebar
      tasks={tasks}
      sessions={sessions}
      loading={tasksLoading || sessionsLoading}
      error={[tasksError, sessionsError].filter(Boolean).join(' · ')}
      index={sessionIndex}
      selectedTaskId={selectedTaskId}
      selectedSessionId={selectedSessionId}
      showArchived={showArchivedSessions}
      drawerOpen={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      onNewSession={startNewSession}
      onSelectTask={openTask}
      onSelectSession={session => { void openChatSession(session); }}
      onToggleSessionPinned={session => { void mutateChatSession(session, { pinned: !session.pinned }); }}
      onArchiveSession={session => { void mutateChatSession(session, { archived: true }); }}
      onRestoreSession={session => { void mutateChatSession(session, { archived: false }); }}
      onDeleteSession={session => { void deleteChatSession(session); }}
      onToggleArchived={() => setShowArchivedSessions(value => !value)}
      onTogglePinned={taskId => updateSessionIndex(current => ({ ...current, pinnedIds: current.pinnedIds.includes(taskId) ? current.pinnedIds.filter(id => id !== taskId) : [...current.pinnedIds, taskId] }))}
      onArchive={taskId => updateSessionIndex(current => ({ ...current, archivedIds: current.archivedIds.includes(taskId) ? current.archivedIds : [...current.archivedIds, taskId] }))}
      onRestore={taskId => updateSessionIndex(current => ({ ...current, archivedIds: current.archivedIds.filter(id => id !== taskId) }))}
      onDelete={task => void deleteTask(task)}
      busyTaskId={busyTaskId}
      onToggleSort={() => updateSessionIndex(current => ({ ...current, newestFirst: !current.newestFirst }))}
    />
    <section className="decision-start-main">
      <header className="decision-start-topbar">
        <button type="button" className="decision-icon-button decision-mobile-menu" aria-label={t('decision.openSessions')} aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu size={19} aria-hidden="true" /></button>
        <div className="decision-start-title"><h1>{t('decision.start')}</h1><small>{t('decision.startSubtitle')}</small></div>
        <div className="decision-start-modes" role="group" aria-label={t('decision.workModes')}>
          {START_ROLE_ITEMS.filter(item => !isReadOnly || item.route !== 'routing').map(item => <a key={item.route} href={`#/${item.route}`} aria-label={t(item.labelKey)} title={t(item.labelKey)} aria-current={item.route === 'start' ? 'page' : undefined}>
            <item.icon size={18} aria-hidden="true" /><span>{t(item.labelKey)}</span>
          </a>)}
        </div>
        <button type="button" className="decision-icon-button decision-new-session-quick" aria-label={t('decision.newSession')} title={t('decision.newSession')} onClick={startNewSession}><Plus size={18} aria-hidden="true" /></button>
        <a className="decision-icon-button decision-settings-quick" href="#/settings" aria-label={t('shell.navSettings')} title={t('shell.navSettings')}><Settings size={17} aria-hidden="true" /></a>
      </header>
      <div className="decision-start-alerts">
        {authError && <IdentityGate connected={onIdentityConnected} />}
        {connectionError && <div className="decision-start-error"><p role="alert" className="decision-error">{connectionError}</p><button type="button" onClick={onRefresh}>{t('decision.refresh')}</button></div>}
      </div>
      <div className="decision-chat-thread" aria-live="polite" ref={chatThreadRef}>
        {selectedTask ? <TaskConversation task={selectedTask} /> : selectedSession ? <><StartConversation session={selectedSession} busy={busy} onRetry={() => { void retryInterruptedSession(selectedSession); }} />{result && <article className="decision-response-message"><header><strong>{t('decision.modelReply')}</strong><span>{result.model ?? ''}</span></header>{submittedQuestions.map(question => <section className="decision-answer-part" key={question.id}><h2>{question.question}</h2><strong className="decision-response-answer">{answerLabel(result.answers[question.id], question)}</strong></section>)}<p role="status">{t('decision.sessionReplyNotSaved')}</p></article>}</> : selectedSessionId ? <div className="decision-empty-state" role="status"><LoaderCircle className="decision-spinner" size={20} aria-label={t('decision.loading')} /></div> : result ? <div className="decision-message-stream" data-component="decision-session-message">
          <article className="decision-user-message"><small>{t('decision.youJustNow')}</small>{submittedQuestions.map((question, index) => <section className="decision-message-question" key={question.id}><small>{t('decision.question')} {submittedQuestions.length > 1 ? index + 1 : ''}</small><p>{question.question}</p><ul>{question.choices.map(choice => <li key={choice.id}>{choice.label}</li>)}</ul><AttachmentList attachments={question.assets} /></section>)}{submittedContext.trim() && <details><summary>{t('decision.context')}</summary><pre>{submittedContext}</pre></details>}<AttachmentList attachments={submittedContextAttachments} /></article>
          <article className="decision-response-message"><header><strong>{t('decision.modelReply')}</strong><span>{result.model}</span></header>{submittedQuestions.map(question => <section className="decision-answer-part" key={question.id}><h2>{question.question}</h2><strong className="decision-response-answer">{answerLabel(result.answers[question.id], question)}</strong></section>)}<details><summary>{t('decision.route')}</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></article>
        </div> : receipt ? <div className="decision-message-stream" data-component="decision-session-message">
          <article className="decision-user-message"><small>{t('decision.youJustNow')}</small><p>{submittedQuestions[0]?.question}</p>{submittedQuestions[0] && <ul>{submittedQuestions[0].choices.map(choice => <li key={choice.id}>{choice.label}</li>)}</ul>}</article>
          <article className="decision-response-message" role="status"><header><strong>{t('decision.waiting')}</strong><span>{t('decision.pending')}</span></header><p>{t('decision.waitingForOwner')}</p><code>{receipt.id}</code><a href={taskLink(receipt.id)}>{t('decision.open')}</a></article>
        </div> : <div className="decision-empty-state"><img src={new URL('../brand/systorch.svg', import.meta.url).href} alt="" aria-hidden="true" /><h2>{t('decision.emptyGreeting')}</h2><div>{[t('decision.suggestionOne'), t('decision.suggestionTwo'), t('decision.suggestionThree')].map(text => <button type="button" key={text} onClick={() => change({ question: text })}>{text}</button>)}</div></div>}
      </div>
      <form className="decision-composer decision-chat-composer" data-testid="decision-composer" aria-busy={busy} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <details className="decision-shared-context" ref={contextDetailsRef}><summary>{t('decision.contextOptional')}</summary><label className="sr-only" htmlFor="decisionContext">{t('decision.context')}</label><textarea id="decisionContext" aria-label={t('decision.context')} rows={2} value={draft.context} onChange={event => change({ context: event.target.value })} onPaste={event => pasteAttachments('context', event)} disabled={busy} placeholder={t('decision.contextPlaceholder')} />
          <div className="decision-attachment-toolbar">
            <button type="button" className="decision-attachment-icon" aria-label={t('decision.addPhoto')} title={t('decision.addPhoto')} disabled={busy} onClick={() => contextFilesRef.current?.click()}><ImagePlus size={17} aria-hidden="true" /></button>
            <button type="button" className="decision-attachment-icon decision-take-photo" aria-label={t('decision.takePhoto')} title={t('decision.takePhoto')} disabled={busy} onClick={() => contextCameraRef.current?.click()}><Camera size={17} aria-hidden="true" /></button>
            <button type="button" className="decision-attachment-icon" aria-label={t('decision.addFile')} title={t('decision.addFile')} disabled={busy} onClick={() => contextFilePickerRef.current?.click()}><FilePlus2 size={17} aria-hidden="true" /></button>
          </div>
          <input ref={contextFilesRef} className="decision-file-picker" data-testid="shared-image-input" type="file" accept="image/*" multiple aria-label={t('decision.addPhoto')} onChange={event => { if (event.currentTarget.files) appendAttachments('context', event.currentTarget.files); event.currentTarget.value = ''; }} />
          <input ref={contextCameraRef} className="decision-file-picker" data-testid="shared-camera-input" type="file" accept="image/*" capture="environment" aria-label={t('decision.takePhoto')} onChange={event => { if (event.currentTarget.files) appendAttachments('context', event.currentTarget.files); event.currentTarget.value = ''; }} />
          <input ref={contextFilePickerRef} className="decision-file-picker" data-testid="shared-file-input" type="file" multiple aria-label={t('decision.addFile')} onChange={event => { if (event.currentTarget.files) appendAttachments('context', event.currentTarget.files); event.currentTarget.value = ''; }} />
          <AttachmentList attachments={contextAttachments} removeLabel={t('decision.removeAttachment')} onRemove={reference => removeAttachment('context', reference)} />
        </details>
        {queuedForRender.length > 0 && <div className="decision-question-queue" aria-label={t('decision.queueQuestion')}>
          {queuedForRender.map((question, index) => <div className="decision-question-queue__item" key={question.id}>
            <strong>{t('decision.question')} {index + 1} · {t(`decision.type.${question.type}` as MessageKey)}</strong><span>{question.question}</span><small>{question.choices.length ? `${question.choices.length} · ${question.type === 'score' ? t('decision.scoreLevels') : question.type === 'noul' ? t('decision.noulLabels') : t('decision.choices')}` : t('decision.boxNoOptions')}{question.assets.length ? ` · ${question.assets.length} ${t('decision.attachments')}` : ''}</small>
            <button type="button" aria-label={t('decision.moveQuestionUp')} disabled={index === 0} onClick={() => moveQueuedQuestion(index, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
            <button type="button" aria-label={t('decision.moveQuestionDown')} disabled={index === queuedForRender.length - 1} onClick={() => moveQueuedQuestion(index, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
            <button type="button" aria-label={t('decision.removeQuestion')} onClick={() => removeQueuedQuestion(index)}><Trash2 size={14} aria-hidden="true" /></button>
          </div>)}
        </div>}
        <div className="decision-question-heading"><strong>{t('decision.question')} {queuedForRender.length > 0 ? queuedForRender.length + 1 : ''}</strong><span>{t(`decision.type.${draft.questionType}` as MessageKey)}</span></div>
        <label className="sr-only" htmlFor="decisionQuestion">{t('decision.question')}</label>
        <textarea ref={questionInputRef} id="decisionQuestion" className="decision-chat-input" aria-label={t('decision.question')} rows={2} value={draft.question} onChange={event => change({ question: event.target.value })} onPaste={event => pasteAttachments('question', event)} onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229 || event.shiftKey) return;
          const touch = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches;
          if (touch) return;
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) addQuestionToQueue();
          else if (canSend) event.currentTarget.form?.requestSubmit();
        }} disabled={busy} placeholder={t('decision.questionPlaceholder')} />
        <div className="decision-attachment-toolbar">
          <button type="button" className="decision-attachment-icon" aria-label={t('decision.addPhoto')} title={t('decision.addPhoto')} disabled={busy} onClick={() => questionFilesRef.current?.click()}><ImagePlus size={17} aria-hidden="true" /></button>
          <button type="button" className="decision-attachment-icon decision-take-photo" aria-label={t('decision.takePhoto')} title={t('decision.takePhoto')} disabled={busy} onClick={() => questionCameraRef.current?.click()}><Camera size={17} aria-hidden="true" /></button>
          <button type="button" className="decision-attachment-icon" aria-label={t('decision.addFile')} title={t('decision.addFile')} disabled={busy} onClick={() => questionFilePickerRef.current?.click()}><FilePlus2 size={17} aria-hidden="true" /></button>
        </div>
        <input ref={questionFilesRef} className="decision-file-picker" data-testid="question-image-input" type="file" accept="image/*" multiple aria-label={t('decision.addPhoto')} onChange={event => { if (event.currentTarget.files) appendAttachments('question', event.currentTarget.files); event.currentTarget.value = ''; }} />
        <input ref={questionCameraRef} className="decision-file-picker" data-testid="question-camera-input" type="file" accept="image/*" capture="environment" aria-label={t('decision.takePhoto')} onChange={event => { if (event.currentTarget.files) appendAttachments('question', event.currentTarget.files); event.currentTarget.value = ''; }} />
        <input ref={questionFilePickerRef} className="decision-file-picker" data-testid="question-file-input" type="file" multiple aria-label={t('decision.addFile')} onChange={event => { if (event.currentTarget.files) appendAttachments('question', event.currentTarget.files); event.currentTarget.value = ''; }} />
        <AttachmentList attachments={questionAttachments} removeLabel={t('decision.removeAttachment')} onRemove={reference => removeAttachment('question', reference)} />
        <div className="decision-chat-options">
          <label>{t('decision.questionType')}<select aria-label={t('decision.questionType')} value={draft.questionType} onChange={event => change({ questionType: event.target.value as Question['type'], choices: '' })} disabled={busy}>
            <option value="noul">{t('decision.type.noul')}</option><option value="choice">{t('decision.type.choice')}</option><option value="score">{t('decision.type.score')}</option><option value="box">{t('decision.type.box')}</option>
          </select></label>
          {draft.questionType !== 'box' && <label>{draft.questionType === 'score' ? t('decision.scoreLevels') : draft.questionType === 'noul' ? t('decision.noulLabels') : t('decision.choices')}<textarea aria-label={draft.questionType === 'score' ? t('decision.scoreLevels') : draft.questionType === 'noul' ? t('decision.noulLabels') : t('decision.choices')} rows={2} value={draft.choices} onChange={event => change({ choices: event.target.value })} disabled={busy} placeholder={draft.questionType === 'score' ? t('decision.scoreLevelsPlaceholder') : draft.questionType === 'noul' ? t('decision.noulLabelsPlaceholder') : t('decision.choicesPlaceholder')} /></label>}
          {draft.questionType === 'box' && <p className="decision-box-guidance">{t('decision.boxNoOptions')}</p>}
          <details><summary>{t('decision.entry')}: {draft.entry === 'human:owner' ? t('decision.human') : draft.entry.slice('model:'.length)}</summary><select aria-label={t('decision.entry')} value={draft.entry} onChange={event => change({ entry: event.target.value })} disabled={busy}><option value="human:owner">{t('decision.human')}</option>{models.map(model => <option key={model.id} value={`model:${model.id}`}>{model.id}</option>)}</select></details>
        </div>
        <div className="decision-composer-actions"><button type="button" className="decision-add-question" disabled={busy || !draftValid} aria-label={t('decision.queueQuestion')} title={t('decision.queueQuestion')} onClick={addQuestionToQueue}><Plus size={17} aria-hidden="true" /></button><button className="decision-primary decision-send-button" type="submit" disabled={!canSend} aria-label={t(busy ? 'decision.sending' : 'decision.send')} title={t('decision.send')}>
          {busy ? <LoaderCircle className="decision-spinner" size={18} /> : <ArrowUpRight size={18} />}
        </button></div>
      </form>
      {(error || tasksError) && <p role="alert" className="decision-error decision-start-inline-error">{error || tasksError}<br />{error && t('decision.retry')}</p>}
      <footer className="decision-privacy">{t('decision.privacy')}</footer>
    </section>
  </div>;
}

function AttachmentList({ attachments, removeLabel, onRemove }: { attachments: readonly DraftAttachment[]; removeLabel?: string; onRemove?: (reference: string) => void }) {
  const { t } = useI18n();
  if (!attachments.length) return null;
  return <div className="decision-attachment-list" aria-label={t('decision.attachments')} data-testid="attachment-list">
    {attachments.map(attachment => <div className="decision-attachment-chip" key={attachment.reference} data-testid="attachment-chip">
      {attachment.file.type.startsWith('image/') ? <img src={attachment.previewUrl} alt={attachment.file.name} />
        : attachment.file.type.startsWith('audio/') ? <audio controls preload="metadata" src={attachment.previewUrl} aria-label={attachment.file.name} />
          : attachment.file.type.startsWith('video/') ? <video controls preload="metadata" src={attachment.previewUrl} aria-label={attachment.file.name} />
            : <span className="decision-attachment-file"><FilePlus2 size={16} aria-hidden="true" />{attachment.file.name}</span>}
      {onRemove && <button type="button" className="decision-attachment-remove" aria-label={`${removeLabel ?? 'Remove attachment'}: ${attachment.file.name}`} onClick={() => onRemove(attachment.reference)}><X size={14} aria-hidden="true" /></button>}
    </div>)}
  </div>;
}

function TaskAssetPreview({ taskId, reference, asset }: { taskId: string; reference: string; asset: RequestAsset }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string>('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let objectUrl = '';
    setFailed(false);
    if (asset.data_base64) {
      const mime = asset.mime_type || (asset.type === 'image' ? `image/${asset.format ?? 'png'}` : 'application/octet-stream');
      setSrc(`data:${mime};base64,${asset.data_base64}`);
    } else if (asset.asset_id) {
      setSrc('');
      fetchTaskAsset(taskId, asset.asset_id).then(blob => {
        if (live) { objectUrl = URL.createObjectURL(blob); setSrc(objectUrl); }
      }).catch(() => { if (live) setFailed(true); });
    } else {
      setFailed(true);
    }
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [taskId, asset.asset_id, asset.data_base64, asset.format, asset.mime_type, asset.type]);
  if (failed) return <span className="decision-asset-unavailable">{asset.filename ?? reference} · {t('decision.assetUnavailable')}</span>;
  if (!src) return <span className="decision-asset-loading">{asset.filename ?? reference} · {t('decision.loading')}</span>;
  if (asset.type === 'image') return <img className="decision-task-image" data-testid="task-image-preview" src={src} alt={asset.filename ?? reference} />;
  if (asset.type === 'audio') return <audio controls preload="metadata" data-testid="task-audio-preview" src={src} aria-label={asset.filename ?? reference} />;
  if (asset.type === 'video') return <video controls preload="metadata" data-testid="task-video-preview" src={src} aria-label={asset.filename ?? reference} />;
  return <a href={src} data-testid="task-file-preview" download={asset.filename ?? reference}><FilePlus2 size={15} aria-hidden="true" />{asset.filename ?? reference}</a>;
}

function TaskAssetGallery({ task, references }: { task: Task; references: readonly string[] }) {
  const { t } = useI18n();
  const assets = task.request.assets ?? {};
  if (!references.length) return null;
  return <div className="decision-task-assets" aria-label={t('decision.attachments')}>
    {references.filter(reference => assets[reference]).map(reference => <div className="decision-task-asset" key={reference}>
      <TaskAssetPreview taskId={task.id} reference={reference} asset={assets[reference]} />
    </div>)}
  </div>;
}

function StartSessionAssetPreview({ sessionId, reference, asset }: { sessionId: string; reference: string; asset: RequestAsset }) {
  const { t } = useI18n();
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let objectUrl = '';
    setFailed(false);
    if (asset.asset_id) {
      setSrc('');
      fetchStartSessionAsset(sessionId, asset.asset_id).then(blob => {
        if (live) { objectUrl = URL.createObjectURL(blob); setSrc(objectUrl); }
      }).catch(() => { if (live) setFailed(true); });
    } else if (asset.data_base64) {
      const mime = asset.mime_type || (asset.type === 'image' ? `image/${asset.format ?? 'png'}` : 'application/octet-stream');
      setSrc(`data:${mime};base64,${asset.data_base64}`);
    } else setFailed(true);
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [sessionId, asset.asset_id, asset.data_base64, asset.format, asset.mime_type, asset.type]);
  if (failed) return <span className="decision-asset-unavailable">{asset.filename ?? reference} · {t('decision.assetUnavailable')}</span>;
  if (!src) return <span className="decision-asset-loading">{asset.filename ?? reference} · {t('decision.loading')}</span>;
  if (asset.type === 'image') return <img className="decision-task-image" src={src} alt={asset.filename ?? reference} />;
  if (asset.type === 'audio') return <audio controls preload="metadata" src={src} aria-label={asset.filename ?? reference} />;
  if (asset.type === 'video') return <video controls preload="metadata" src={src} aria-label={asset.filename ?? reference} />;
  return <a href={src} download={asset.filename ?? reference}><FilePlus2 size={15} aria-hidden="true" />{asset.filename ?? reference}</a>;
}

function StartSessionAssetGallery({ sessionId, request, references }: { sessionId: string; request: JevRequest; references: readonly string[] }) {
  const { t } = useI18n();
  const assets = request.assets ?? {};
  if (!references.length) return null;
  return <div className="decision-task-assets" aria-label={t('decision.attachments')}>
    {references.filter(reference => assets[reference]).map(reference => <div className="decision-task-asset" key={reference}>
      <StartSessionAssetPreview sessionId={sessionId} reference={reference} asset={assets[reference]} />
    </div>)}
  </div>;
}

function StartConversation({ session, busy, onRetry }: { session: StartSession; busy: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  const requests = new Map(session.messages.flatMap(message => message.kind === 'request' ? [[message.id, message.request] as const] : []));
  return <div className="decision-message-stream" data-component="decision-session-message">
    {session.messages.map(message => {
      if (message.kind === 'request') {
        const questions = directRequestQuestions(message.request, message.question_order);
        const knownAssets = new Set(Object.keys(message.request.assets ?? {}));
        const sharedAssets = assetReferences(message.request.state, knownAssets);
        const sharedText = contextTextForDisplay(message.request.state);
        return <article className="decision-user-message" data-component="user-message" key={message.id}>
          <small>{t('decision.youJustNow')} · {new Date(message.created_at * 1000).toLocaleString()}</small>
          {questions.map((question, index) => <section className="decision-message-question" key={question.id}>
            {questions.length > 1 && <small>{t('decision.question')} {index + 1}</small>}
            <p>{question.question}</p>
            {question.choices.length > 0 && <ul>{question.choices.map(choice => <li key={choice.id}>{choice.label}</li>)}</ul>}
            <StartSessionAssetGallery sessionId={session.summary.id} request={message.request} references={question.assetReferences} />
          </section>)}
          {sharedText && sharedText !== 'null' && <details><summary>{t('decision.context')}</summary><pre>{sharedText}</pre></details>}
          <StartSessionAssetGallery sessionId={session.summary.id} request={message.request} references={sharedAssets} />
        </article>;
      }
      const request = requests.get(message.reply_to);
      const requestMessage = session.messages.find(candidate => candidate.kind === 'request' && candidate.id === message.reply_to);
      const questions = request ? directRequestQuestions(request, requestMessage?.kind === 'request' ? requestMessage.question_order : undefined) : [];
      if (message.kind === 'failure') return <article className="decision-response-message" key={message.id}>
        <header><strong>{t('decision.modelReply')}</strong><span>{t('decision.attemptFailed')}</span></header>
        <p>{message.error_code}{message.status ? ` · HTTP ${message.status}` : ''}</p>
        {message.request_id && <small>{t('decision.requestId')}: {message.request_id}</small>}
      </article>;
      return <article className="decision-response-message" key={message.id}>
        <header><strong>{t('decision.modelReply')}</strong><span>{message.response.model ?? ''}</span></header>
        {questions.map(question => <section className="decision-answer-part" key={question.id}>
          <h2>{question.question}</h2>
          <strong className="decision-response-answer">{answerLabel(message.response.answers[question.id], question)}</strong>
        </section>)}
        <details><summary>{t('decision.route')}</summary><pre>{JSON.stringify(message.response, null, 2)}</pre></details>
      </article>;
    })}
    {session.summary.interrupted && <article className="decision-response-message" role="status">
      <header><strong>{t('decision.modelReply')}</strong>{busy && <LoaderCircle className="decision-spinner" size={16} aria-label={t('decision.loading')} />}</header>
      <p>{t(busy ? 'decision.requestInProgress' : 'decision.requestInterrupted')}</p>
      {!busy && <button type="button" className="decision-primary" onClick={onRetry}>{t('decision.retryInterrupted')}</button>}
    </article>}
  </div>;
}

function TaskConversation({ task }: { task: Task }) {
  const { t } = useI18n();
  const questions = taskQuestions(task);
  const observations = taskObservations(task);
  const knownAssets = new Set(Object.keys(task.request.assets ?? {}));
  const sharedState = sessionState(task);
  const sharedAssetReferences = assetReferences(sharedState, knownAssets);
  const contextText = contextTextForDisplay(sharedState);
  return <div className="decision-message-stream" data-component="decision-session-message">
    <article className="decision-user-message" data-component="user-message">
      <small>{t('decision.youJustNow')} · {new Date(task.created_at * 1000).toLocaleString()}</small>
      {questions.map((question, index) => <section className="decision-message-question" key={question.id}>
        {questions.length > 1 && <small>{t('decision.question')} {index + 1}</small>}
        <p>{question.question}</p>
        <ul>{question.choices.map(choice => <li key={choice.id}>{choice.label}</li>)}</ul>
        <TaskAssetGallery task={task} references={question.assetReferences} />
      </section>)}
      {contextText && contextText !== 'null' && <details><summary>{t('decision.context')}</summary><pre>{contextText}</pre></details>}
      <TaskAssetGallery task={task} references={sharedAssetReferences} />
      <details><summary>{t('decision.requestId')}: {task.id}</summary><p>{t('decision.revision')} {task.revision}</p></details>
    </article>
    <article className="decision-response-message" data-component="response-message" aria-live="polite">
      <header><strong>{t('decision.modelReply')}</strong><span className={`decision-state is-${task.status}`}>{t(`decision.${task.status}` as MessageKey)}</span></header>
      {task.status === 'pending' && <><p>{t('decision.waitingForOwner')}</p><a href={taskLink(task.id)}>{t('decision.open')}</a></>}
      {questions.filter(question => observations[question.id]).map(question => {
        const observation = observations[question.id];
        const answer = observationLabel(question, observation);
        return <section className="decision-answer-part" key={question.id}>
          <h2>{question.question}</h2>
          {answer && <strong className="decision-response-answer">{answer}</strong>}
          {'note' in observation && observation.note && <p>{observation.note}</p>}
          {'condition' in observation && <p>{observation.condition}</p>}
          {'reason' in observation && <p>{observation.reason}</p>}
        </section>;
      })}
      {task.status !== 'pending' && Object.keys(observations).length === 0 && <p>{t(`decision.${task.status}` as MessageKey)}</p>}
      <details><summary>{t('decision.route')}</summary><pre>{JSON.stringify({ entry: task.request.entry, caller: task.caller, assignee: task.assignee, projection: task.projection_policy, observations }, null, 2)}</pre></details>
    </article>
  </div>;
}

function Desk({ identity }: { identity: { id: string; can_answer: boolean } }) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.hash.split('?')[1]).get('task') ?? selectedId);
  const [detail, setDetail] = useState<Task | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      try {
        const list = await decisionRequest<Task[]>(`/decisions?offset=${offset}`, undefined, 'GET', controller.signal);
        const id = selected || list[0]?.id;
        const task = id ? await decisionRequest<Task>(`/decisions/${encodeURIComponent(id)}`, undefined, 'GET', controller.signal) : null;
        if (!controller.signal.aborted) { setTasks(list); setDetail(task); setError(''); }
      } catch (e) { if (!controller.signal.aborted) { setError(errorMessage(e, t)); if (e instanceof DecisionError && e.status === 410) setDetail(null); } }
      finally { if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(() => { if (document.visibilityState === 'visible') void sync(); else timer = setTimeout(sync, 5000); }, 5000); } }
    };
    void sync();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [selected, offset, tick, t]);
  const refresh = useCallback(() => setTick(v => v + 1), []);
  useEffect(() => {
    const navigate = () => { const id = new URLSearchParams(window.location.hash.split('?')[1]).get('task'); if (id) { selectedId = id; setSelected(id); } };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const select = (task: Task) => { selectedId = task.id; setSelected(task.id); setDetail(task); window.history.replaceState(null, '', taskLink(task.id)); };
  return <section className="decision-desk">
    <div className="decision-actions"><a href="#/start">+ {t('decision.new')}</a><button type="button" onClick={refresh}><RefreshCw size={14} />{t('decision.refresh')}</button></div>
    <p className="decision-hint">{t('decision.notice')}</p>
    {error && <p role="alert" className="decision-error">{error}</p>}
    <div className="decision-split"><aside className="decision-list" aria-busy={loading}>
      {loading && <LoaderCircle className="decision-spinner" aria-label={t('decision.loading')} />}
      {!loading && tasks.length === 0 && <p>{t('decision.empty')}</p>}
      {tasks.map(task => <button key={task.id} type="button" className="decision-list-item" aria-pressed={detail?.id === task.id} onClick={() => select(task)}>
        <span className={`decision-state is-${task.status}`}>{t(`decision.${task.status}` as MessageKey)}</span><strong>{sessionQuestion(task)}</strong><small>{new Date(task.created_at * 1000).toLocaleString()}</small>
      </button>)}
      <div className="decision-actions"><button disabled={offset === 0} onClick={() => { setOffset(v => Math.max(0, v - 25)); setSelected(''); }}>{t('decision.previous')}</button><button disabled={tasks.length < 25} onClick={() => { setOffset(v => v + 25); setSelected(''); }}>{t('decision.next')}</button></div>
    </aside>
    {detail && <AnswerPanel key={`${identity.id}/${detail.id}/${detail.revision}`} task={detail} canAnswer={identity.can_answer} canRevise={identity.id === detail.caller} changed={task => { setDetail(task); refresh(); }} erased={() => { selectedId = ''; setSelected(''); setDetail(null); window.history.replaceState(null, '', '#/desk'); refresh(); }} />}</div>
  </section>;
}

function AnswerPanel({ task, canAnswer, canRevise, changed, erased }: { task: Task; canAnswer: boolean; canRevise: boolean; changed: (task: Task) => void; erased: () => void }) {
  const { t } = useI18n();
  const questions = taskQuestions(task);
  const knownAssets = new Set(Object.keys(task.request.assets ?? {}));
  const sharedState = sessionState(task);
  const sharedAssetReferences = assetReferences(sharedState, knownAssets);
  const accepted = taskObservations(task);
  const draftKey = `${task.id}/${task.revision}`;
  const [draft, setDraft] = useState<AnswerDraft>(() => drafts.get(draftKey) ?? { choice: '', note: '', conditional: false, questionChoices: {}, boxes: {} });
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const [error, setError] = useState('');
  const patch = (value: Partial<typeof draft>) => setDraft(current => { const next = { ...current, ...value }; drafts.set(draftKey, next); return next; });
  const selectedValue = (question: DecisionQuestionView) => draft.questionChoices[question.id] ?? (questions.length === 1 ? draft.choice : '');
  const selectedBox = (question: DecisionQuestionView) => draft.boxes[question.id] ?? { top: '', bottom: '', left: '', right: '' };
  const remainingQuestions = questions.filter(question => !accepted[question.id]);
  const boxIsValid = (question: DecisionQuestionView) => {
    const box = selectedBox(question);
    const edges = [box.top, box.bottom, box.left, box.right].map(Number);
    return Object.values(box).every(value => value.trim() !== '')
      && edges.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
      && edges[0] < edges[1] && edges[2] < edges[3];
  };
  const canAttachCondition = remainingQuestions.length > 0 && remainingQuestions.every(question => question.type === 'choice');
  const answerReady = remainingQuestions.length > 0
    && remainingQuestions.every(question => question.type === 'box' ? boxIsValid(question) : Boolean(selectedValue(question)))
    && (!draft.conditional || (canAttachCondition && Boolean(draft.note.trim())));
  const act = async (action: 'answer' | 'decline' | 'clarify' | 'cancel' | 'erase') => {
    if (gate.current) return;
    if (action === 'erase' && !window.confirm(t('decision.confirmErase'))) return;
    if (action === 'cancel' && !window.confirm(t('decision.confirmCancel'))) return;
    gate.current = true; setBusy(true); setError('');
    try {
      if (action === 'erase') { await decisionRequest(`/decisions/${task.id}`, undefined, 'DELETE'); drafts.delete(draftKey); erased(); return; }
      let result: Task;
      if (action === 'cancel') result = await decisionRequest(`/decisions/${task.id}/cancel`, {});
      else if (action === 'clarify') result = await decisionRequest(`/decisions/${task.id}/clarifications`, { revision: task.revision, question: draft.note });
      else {
        const observations: Record<string, Observation> = Object.fromEntries(remainingQuestions.map(question => {
          const value = selectedValue(question);
          let observation: Observation;
          if (action === 'decline') observation = { kind: 'declined', reason: draft.note };
          else if (question.type === 'choice' && draft.conditional) observation = { kind: 'conditional', choice_id: value, condition: draft.note };
          else if (question.type === 'choice') observation = { kind: 'answered', choice_id: value, ...(draft.note.trim() ? { note: draft.note } : {}) };
          else if (question.type === 'noul') observation = { kind: 'noul', value: value === 'true', ...(draft.note.trim() ? { note: draft.note } : {}) };
          else if (question.type === 'score') observation = { kind: 'score', level_index: Number(value), ...(draft.note.trim() ? { note: draft.note } : {}) };
          else {
            const box = selectedBox(question);
            observation = { kind: 'box', top: Number(box.top), bottom: Number(box.bottom), left: Number(box.left), right: Number(box.right), ...(draft.note.trim() ? { note: draft.note } : {}) };
          }
          return [question.id, observation];
        }));
        result = task.request.questions
          ? await answerDecision(task, { observations })
          : await answerDecision(task, { observation: observations.choice });
      }
      changed(result);
    } catch (e) { setError(errorMessage(e, t)); }
    finally { gate.current = false; setBusy(false); }
  };
  const pending = task.status === 'pending';
  return <article className="decision-answer" aria-busy={busy}>
    <div className="decision-task-meta"><span className={`decision-state is-${task.status}`}>{t(`decision.${task.status}` as MessageKey)}</span><span>{t('decision.revision')} {task.revision}</span><span>{t('decision.deadline')} {new Date(task.deadline * 1000).toLocaleString()}</span></div>
    <code>{t('decision.from')} {task.caller} → {task.assignee}</code>
    <h2>{sessionQuestion(task)}</h2><code>{task.id}</code>
    <pre className="decision-context">{contextTextForDisplay(sharedState)}</pre>
    <TaskAssetGallery task={task} references={sharedAssetReferences} />
    {task.clarifications.map((q, i) => <p className="decision-clarification" key={i}><CircleHelp size={14} />{q}</p>)}
    <form onSubmit={event => { event.preventDefault(); if (answerReady) void act('answer'); }}>
      <fieldset disabled={busy || !pending || !canAnswer}><legend>{t('decision.selected')}</legend>
        {questions.map((question, index) => <section className="decision-answer-question" key={question.id}>
          <strong>{questions.length > 1 ? `${t('decision.question')} ${index + 1} · ` : ''}{question.question}</strong>
          <TaskAssetGallery task={task} references={question.assetReferences} />
          {accepted[question.id] ? <p>{t('decision.saved')}</p> : question.type === 'box' ? <div className="decision-box-coordinates">
            {([
              ['top', t('decision.boxTop')], ['bottom', t('decision.boxBottom')],
              ['left', t('decision.boxLeft')], ['right', t('decision.boxRight')],
            ] as const).map(([edge, label]) => <label key={edge}>{label}
              <input type="number" min="0" max="1" step="0.01" value={selectedBox(question)[edge]} aria-label={`${question.question} · ${label}`} onChange={event => patch({ boxes: { ...draft.boxes, [question.id]: { ...selectedBox(question), [edge]: event.target.value } } })} />
            </label>)}
            <small>{t('decision.boxRange')}</small>
          </div> : question.choices.map(choice => <label className="decision-choice" key={choice.id} data-selected={selectedValue(question) === choice.id}>
            <input type="radio" name={`answer-${task.id}-${question.id}`} value={choice.id} checked={selectedValue(question) === choice.id} onChange={() => patch({ choice: questions.length === 1 ? choice.id : draft.choice, questionChoices: { ...draft.questionChoices, [question.id]: choice.id } })} /><span>{question.type === 'score' ? `${choice.id} · ` : ''}{choice.label}</span>
          </label>)}
        </section>)}
        {canAttachCondition && <button type="button" className="decision-toggle" aria-pressed={draft.conditional} onClick={() => patch({ conditional: !draft.conditional })}>{t('decision.conditional')}</button>}
        <label>{t('decision.reason')}<textarea aria-label={t('decision.reason')} rows={2} value={draft.note} onChange={e => patch({ note: e.target.value })} /></label>
      </fieldset>
      {pending && <div className="decision-actions">
        {canAnswer && <><button type="submit" className="decision-primary" disabled={busy || !answerReady}>{busy && <LoaderCircle size={15} className="decision-spinner" />}{t(busy ? 'decision.busy' : 'decision.confirm')}</button><button type="button" onClick={() => void act('decline')} disabled={busy || !draft.note.trim()}>{t('decision.decline')}</button><button type="button" onClick={() => void act('clarify')} disabled={busy || !draft.note.trim()}>{t('decision.clarify')}</button></>}
        <button type="button" onClick={() => void act('cancel')} disabled={busy}>{t('decision.cancel')}</button>
      </div>}
    </form>
    {Object.keys(accepted).length > 0 && <div role="status" className="decision-result"><h3>{t('decision.saved')}</h3>{questions.filter(question => accepted[question.id]).map(question => {
      const observation = accepted[question.id];
      const answer = observationLabel(question, observation);
      return <section className="decision-answer-question" key={question.id}><strong>{question.question}</strong>
        {answer && <p>{answer}</p>}
        {'condition' in observation && <p>{observation.condition}</p>}{'reason' in observation && <p>{observation.reason}</p>}
        {'note' in observation && observation.note && <p>{observation.note}</p>}
        <small>{t(['answered', 'noul', 'score', 'box'].includes(observation.kind) ? 'decision.projection' : 'decision.notProjected')}</small>
      </section>;
    })}</div>}
    {pending && canRevise && !task.request.questions && <RevisionEditor task={task} changed={changed} />}
    {error && <p role="alert" className="decision-error">{error}</p>}
    <details><summary>{t('decision.details')}</summary><pre>{JSON.stringify(task, null, 2)}</pre></details>
    <button type="button" onClick={() => { if (window.confirm(t('decision.exportConfirm'))) void saveJsonFile(`${task.id}.json`, JSON.stringify(task, null, 2)).catch(e => setError(String(e))); }}>{t('decision.export')}</button>
    {!pending && <button type="button" className="decision-erase" disabled={busy} onClick={() => void act('erase')}>{t('decision.erase')}</button>}
  </article>;
}

function RevisionEditor({ task, changed }: { task: Task; changed: (task: Task) => void }) {
  const { t } = useI18n();
  const [question, setQuestion] = useState(task.request.question ?? sessionQuestion(task));
  const [context, setContext] = useState(JSON.stringify(sessionState(task), null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(false);
  return <details><summary>{t('decision.revise')}</summary><p>{t('decision.revisionHint')}</p>
    <form onSubmit={event => {
      event.preventDefault(); if (gate.current) return; gate.current = true; setBusy(true); setError('');
      void decisionRequest<Task>(`/decisions/${task.id}/revisions`, { revision: task.revision, question, context: contextValue(context), choices: task.request.choices ?? [] })
        .then(changed).catch(e => setError(errorMessage(e, t))).finally(() => { gate.current = false; setBusy(false); });
    }}><label>{t('decision.question')}<textarea aria-label={t('decision.question')} value={question} onChange={e => setQuestion(e.target.value)} disabled={busy} required /></label>
      <label>{t('decision.context')}<textarea aria-label={t('decision.context')} value={context} onChange={e => setContext(e.target.value)} disabled={busy} /></label>
      <button type="submit" disabled={busy}>{t(busy ? 'decision.busy' : 'decision.saveRevision')}</button>
    </form>{error && <p role="alert">{error}</p>}
  </details>;
}
