import type { Task } from '../generated/Task';

const STORAGE_KEY = 'systorch:start-session-index:v1';

/** Only task IDs and view preferences live in browser storage; task content stays in the encrypted daemon store. */
export interface StartSessionIndex {
  pinnedIds: string[];
  archivedIds: string[];
  lastReadAt: Record<string, number>;
  newestFirst: boolean;
}

export function emptyStartSessionIndex(): StartSessionIndex {
  return { pinnedIds: [], archivedIds: [], lastReadAt: {}, newestFirst: true };
}

export function readStartSessionIndex(): StartSessionIndex {
  if (typeof window === 'undefined') return emptyStartSessionIndex();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStartSessionIndex();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return emptyStartSessionIndex();
    const record = value as Partial<StartSessionIndex>;
    return {
      pinnedIds: Array.isArray(record.pinnedIds) ? record.pinnedIds.filter((id): id is string => typeof id === 'string') : [],
      archivedIds: Array.isArray(record.archivedIds) ? record.archivedIds.filter((id): id is string => typeof id === 'string') : [],
      lastReadAt: record.lastReadAt && typeof record.lastReadAt === 'object'
        ? Object.fromEntries(Object.entries(record.lastReadAt).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
        : {},
      newestFirst: record.newestFirst !== false,
    };
  } catch {
    return emptyStartSessionIndex();
  }
}

export function writeStartSessionIndex(index: StartSessionIndex): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

export function sessionTitle(task: Task): string {
  const firstLine = sessionQuestion(task).split(/\r?\n/, 1)[0]?.trim() ?? '';
  return firstLine ? Array.from(firstLine).slice(0, 48).join('') : task.id;
}

export function sessionQuestion(task: Task): string {
  if (task.request.question) return task.request.question;
  const questions = task.request.questions;
  if (!questions) return '';
  const firstId = task.request.question_order?.find(id => id in questions) ?? Object.keys(questions).sort()[0];
  const instructions = questions[firstId]?.instructions;
  if (typeof instructions === 'string') return instructions;
  if (instructions && typeof instructions === 'object' && !Array.isArray(instructions) && 'text' in instructions && typeof instructions.text === 'string') return instructions.text;
  return instructions === undefined ? '' : JSON.stringify(instructions);
}

export function sessionState(task: Task): unknown {
  return task.request.state ?? task.request.context ?? null;
}

export function hasUnreadReply(task: Task, index: StartSessionIndex): boolean {
  const hasReply = task.status === 'completed' || Object.keys(task.observations ?? {}).length > 0 || task.observation !== null;
  return hasReply && (index.lastReadAt[task.id] ?? 0) < task.updated_at;
}

export function orderSessionTasks(tasks: readonly Task[], index: StartSessionIndex, showArchived = false): Task[] {
  const pinned = new Set(index.pinnedIds);
  const archived = new Set(index.archivedIds);
  return tasks
    .filter(task => showArchived ? archived.has(task.id) : !archived.has(task.id))
    .slice()
    .sort((left, right) => {
      const pinDelta = Number(pinned.has(right.id)) - Number(pinned.has(left.id));
      if (pinDelta) return pinDelta;
      const updateDelta = left.updated_at - right.updated_at;
      return index.newestFirst ? -updateDelta : updateDelta;
    });
}
