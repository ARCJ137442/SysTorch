/** M0-only simulated state. This module has no gateway transport or production
 * storage imports. A receipt here never represents a durable daemon decision. */
export const PREVIEW_STORAGE_KEY = 'systorch-m0-preview-v1';
export const WORKSPACES = [
  { id: 'start', label: '开始', hint: '发起一次判断' },
  { id: 'desk', label: '决策台', hint: '需要你的判断' },
  { id: 'coordinate', label: '协调工作台', hint: '入口、来源与路径' },
] as const;
export type Workspace = typeof WORKSPACES[number]['id'];
export const SCENARIOS = [
  { id: 'normal', label: '正常' }, { id: 'empty', label: '尚无入口' },
  { id: 'loading', label: '读取中' }, { id: 'offline', label: '断网与草稿' },
  { id: 'busy', label: '提交中' }, { id: 'expired', label: '已过期' },
  { id: 'conflict', label: '另一设备已回答' }, { id: 'declined', label: '拒绝作答' },
  { id: 'conditional', label: '附条件回答' }, { id: 'error', label: '提交失败' },
  { id: 'draft', label: '草稿恢复' }, { id: 'permission', label: '无作答权限' },
  { id: 'local-stopped', label: '本地服务未启动' },
] as const;
export type Scenario = typeof SCENARIOS[number]['id'];
export interface Entry { id: string; label: string; source: 'model' | 'human'; local: boolean; ready: boolean }
export interface PreviewTask {
  id: string; revision: number; title: string; caller: string;
  context: Record<string, unknown>; options: string[];
  status: 'pending' | 'completed' | 'expired' | 'cancelled';
  draft?: string; draftRevision?: number; draftCondition?: string; clarificationDraft?: string; answer?: string;
  outcome?: 'answered' | 'declined' | 'conditional'; condition?: string;
  origin?: 'start' | 'experiment'; authorized: boolean;
}
export interface PreviewState {
  version: 1; workspace: Workspace; lastWorkspace: Workspace;
  home: 'start' | 'dashboard' | 'last'; scenario: Scenario;
  entries: Entry[]; entryId: string; selectedTaskId: string;
  question: string; options: string; tasks: PreviewTask[];
  lastRequestId?: string;
}
export type PreviewAction =
  | { type: 'navigate'; workspace: Workspace }
  | { type: 'scenario'; scenario: Scenario }
  | { type: 'input'; question: string; options: string }
  | { type: 'entry'; id: string }
  | { type: 'service-state'; id: string; running: boolean }
  | { type: 'add-entry'; label: string }
  | { type: 'select-task'; id: string }
  | { type: 'choose'; id: string; value: string }
  | { type: 'note'; id: string; field: 'draftCondition' | 'clarificationDraft'; value: string }
  | { type: 'respond'; id: string; outcome: 'answered' | 'declined' | 'conditional'; condition?: string }
  | { type: 'revise'; id: string; note: string }
  | { type: 'latest'; id: string }
  | { type: 'create'; id: string }
  | { type: 'cancel'; id: string }
  | { type: 'home'; value: PreviewState['home'] };

export function initialPreview(): PreviewState {
  return {
    version: 1, workspace: 'start', lastWorkspace: 'start', home: 'start', scenario: 'normal',
    entries: [
      { id: 'quick', label: '日常判断', source: 'model', local: false, ready: true },
      { id: 'local', label: '本地 System One', source: 'model', local: true, ready: false },
      { id: 'me', label: '由我判断', source: 'human', local: true, ready: true },
    ], entryId: 'quick', selectedTaskId: 'demo-1042', question: '', options: '先整理资料\n先完成演示',
    tasks: [
      { id: 'demo-1042', revision: 1, title: '下一步先做哪件事？', caller: '项目整理脚本', options: ['先整理资料', '先完成演示'], status: 'pending', authorized: true,
        context: { 目标: '今天留出一个可分享的成果', 可用时间: '45 分钟', 资料: { 状态: '已收齐，尚未分类', 预计耗时: '20 分钟' }, 演示: { 状态: '主流程可用，尚未录制', 预计耗时: '30 分钟' } } },
      { id: 'demo-1041', revision: 1, title: '这封邮件现在发送吗？', caller: '邮件草稿助手', options: ['发送', '保留草稿'], status: 'pending', authorized: true,
        context: { 收件人: '项目协作者（示例）', 主题: '本周进度', 附件: null, 说明: '这只是决策演示，不会发送邮件。' } },
      { id: 'demo-1040', revision: 1, title: '为样本选择更清晰的标题', caller: '人机比较 · 样本 03', options: ['判断，从这里开始', '把问题交给合适的来源'], status: 'pending', authorized: true, origin: 'experiment',
        context: { 盲答: '提交前不显示模型答案', 样本: '03', 目标: '第一次打开产品的人能理解用途' } },
    ],
  };
}

function scenarioState(state: PreviewState, scenario: Scenario): PreviewState {
  // Choosing a normal/offline transport must not erase an existing draft.
  if (['normal', 'offline', 'error', 'busy', 'loading'].includes(scenario)) return { ...state, scenario };
  const next = { ...initialPreview(), workspace: state.workspace, home: state.home, scenario };
  if (scenario === 'empty') next.entries = [];
  if (scenario === 'local-stopped') next.entryId = 'local';
  const task = next.tasks[0];
  if (scenario === 'expired') task.status = 'expired';
  if (scenario === 'permission') task.authorized = false;
  if (scenario === 'draft') { task.draft = task.options[1]; task.draftRevision = 1; }
  if (scenario === 'conflict') { task.revision = 2; task.answer = task.options[0]; task.status = 'completed'; task.outcome = 'answered'; task.draft = task.options[1]; task.draftRevision = 1; }
  if (scenario === 'declined') { task.status = 'completed'; task.outcome = 'declined'; }
  if (scenario === 'conditional') { task.status = 'completed'; task.outcome = 'conditional'; task.answer = task.options[1]; task.condition = '先确认录制内容没有私人信息'; }
  return next;
}

export function answerBlock(task: PreviewTask, scenario: Scenario): string | null {
  if (!task.authorized) return '你没有这条请求的作答权限。请联系请求的管理者。';
  if (task.draftRevision !== undefined && task.draftRevision !== task.revision) return '另一设备已处理这条请求。你的草稿已保留，请先查看最新结果。';
  if (task.status === 'expired') return '这条请求已过期，旧答案不会再被接受。可以请调用方重新发起。';
  if (task.status !== 'pending') return '这条请求已结束。';
  if (scenario === 'offline') return '连接已断开。草稿已留在本浏览器，恢复连接后可重试。';
  if (scenario === 'error') return '模拟提交失败，尚未接受回答。草稿已保留，可以重试。';
  return null;
}

export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case 'navigate': return { ...state, workspace: action.workspace, lastWorkspace: action.workspace };
    case 'scenario': return scenarioState(state, action.scenario);
    case 'input': return { ...state, question: action.question, options: action.options };
    case 'entry': return { ...state, entryId: action.id };
    case 'service-state': return { ...state, entries: state.entries.map(e => e.id === action.id && e.local && e.source === 'model' ? { ...e, ready: action.running } : e) };
    case 'add-entry': return { ...state, scenario: 'normal', entries: [...state.entries, { id: 'custom-demo', label: action.label, source: 'model', local: false, ready: true }], entryId: 'custom-demo', workspace: 'start' };
    case 'select-task': return { ...state, selectedTaskId: action.id };
    case 'choose': return { ...state, tasks: state.tasks.map(t => t.id === action.id && t.status === 'pending' && t.authorized && t.options.includes(action.value) ? { ...t, draft: action.value, draftRevision: t.revision } : t) };
    case 'note': return { ...state, tasks: state.tasks.map(t => t.id === action.id && t.status === 'pending' && t.authorized ? { ...t, [action.field]: action.value } : t) };
    case 'respond': return { ...state, tasks: state.tasks.map(t => {
      if (t.id !== action.id || answerBlock(t, state.scenario) || (action.outcome !== 'declined' && !t.draft)) return t;
      if (action.outcome === 'conditional' && !action.condition?.trim()) return t;
      return { ...t, status: 'completed', outcome: action.outcome, answer: action.outcome === 'declined' ? undefined : t.draft, condition: action.condition?.trim() };
    }) };
    case 'revise': return { ...state, tasks: state.tasks.map(t => t.id === action.id && t.status === 'pending' && t.authorized ? { ...t, revision: t.revision + 1, draft: undefined, draftRevision: undefined, context: { ...t.context, 补充请求: action.note } } : t) };
    case 'latest': return { ...state, tasks: state.tasks.map(t => t.id === action.id ? { ...t, draft: undefined, draftRevision: undefined } : t) };
    case 'cancel': return { ...state, tasks: state.tasks.map(t => t.id === action.id && t.status === 'pending' ? { ...t, status: 'cancelled' } : t) };
    case 'home': return { ...state, home: action.value };
    case 'create': {
      const entry = state.entries.find(e => e.id === state.entryId);
      const options = [...new Set(state.options.split('\n').map(v => v.trim()).filter(Boolean))];
      if (!entry?.ready || !state.question.trim() || options.length < 2 || state.scenario !== 'normal') return state;
      const task: PreviewTask = { id: action.id, revision: 1, title: state.question.trim(), caller: '开始 · 我的判断', context: { 来源: entry.label, 说明: '本次为本地交互模拟，没有发送模型请求' }, options, status: entry.source === 'human' ? 'pending' : 'completed', authorized: true, origin: 'start', ...(entry.source === 'model' ? { answer: options[0], outcome: 'answered' as const } : {}) };
      return { ...state, tasks: [task, ...state.tasks].slice(0, 30), lastRequestId: task.id, question: '' };
    }
  }
}

export function restorePreview(raw: string | null): PreviewState {
  try {
    if (raw && raw.length > 1_000_000) return initialPreview();
    const value = JSON.parse(raw ?? 'null') as PreviewState | null;
    if (!value || value.version !== 1 || !WORKSPACES.some(w => w.id === value.workspace) || !SCENARIOS.some(s => s.id === value.scenario) || !Array.isArray(value.entries) || !Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length > 30 || typeof value.question !== 'string' || typeof value.options !== 'string') return initialPreview();
    if (!value.tasks.every(t => typeof t.id === 'string' && Number.isInteger(t.revision) && typeof t.title === 'string' && typeof t.caller === 'string' && typeof t.authorized === 'boolean' && ['pending', 'completed', 'expired', 'cancelled'].includes(t.status) && Array.isArray(t.options) && t.options.every(o => typeof o === 'string') && t.context && typeof t.context === 'object')) return initialPreview();
    if (!value.entries.every(e => typeof e.id === 'string' && typeof e.label === 'string' && ['human','model'].includes(e.source) && typeof e.ready === 'boolean' && typeof e.local === 'boolean')) return initialPreview();
    const home = value.home === 'last' ? value.lastWorkspace : value.home === 'dashboard' ? 'coordinate' : 'start';
    return { ...value, workspace: WORKSPACES.some(w => w.id === home) ? home : 'start', scenario: ['busy', 'loading'].includes(value.scenario) ? 'normal' : value.scenario };
  } catch { return initialPreview(); }
}
