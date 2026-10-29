import { CoreWorkbench, createCorePreviewSession, type CorePreviewSession } from './CoreWorkbench';
import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, CircleHelp, Clock3, Columns3, Flame, GitBranch, Inbox, LoaderCircle, Moon, Plus, Send, Settings2, ShieldCheck, UserRound, WifiOff, X } from 'lucide-react';
import { PREVIEW_STORAGE_KEY, SCENARIOS, WORKSPACES, answerBlock, initialPreview, previewReducer, restorePreview, type PreviewTask, type Scenario, type Workspace } from './model';

function Torch() {
  return <svg viewBox="0 0 32 40" aria-hidden="true"><path d="M16 3 4 17l8 6-3 8 7 6 7-6-3-8 8-6L16 3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="m16 10-5 8 5 5 5-5-5-8Z" fill="currentColor"/><path d="M16 23v10" stroke="currentColor" strokeWidth="2"/></svg>;
}

function ContextValue({ value, path = '$', depth = 0 }: { value: unknown; path?: string; depth?: number }) {
  if (value === null) return <span className="st-subtle">未提供</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (depth >= 5) return <details><summary>{path} · 展开原始值</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
  return <dl className="st-context">{Object.entries(value).map(([key, item]) => <div key={key}><dt title={`${path}/${key}`}>{key}</dt><dd><ContextValue value={item} path={`${path}/${key}`} depth={depth + 1}/></dd></div>)}</dl>;
}

function TaskStatus({ task }: { task: PreviewTask }) {
  const labels = { pending: '待判断', completed: '已回答', expired: '已过期', cancelled: '已取消' };
  return <span className={`st-status st-status--${task.status}`}>{task.status === 'pending' ? <Clock3 size={13}/> : <Check size={13}/>} {task.outcome === 'declined' ? '已拒答' : task.outcome === 'conditional' ? '附条件回答' : labels[task.status]}</span>;
}

/** Isolated Vite entry: all operations below affect this preview namespace only.
 * The reused DAG may read its existing display preference; HTTP calls and production writes are not permitted. */
export function SysTorchPreview() {
  const [state, dispatch] = useReducer(previewReducer, undefined, () => {
    try { return restorePreview(localStorage.getItem(PREVIEW_STORAGE_KEY)); } catch { return initialPreview(); }
  });
  const coreSession = useRef<CorePreviewSession | null>(null);
  if (coreSession.current === null) coreSession.current = createCorePreviewSession();
  const [dark, setDark] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [entryLabel, setEntryLabel] = useState('我的判断入口');
  const [operation, setOperation] = useState<string | null>(null);
  const pending = useRef<{ token: symbol; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [storageError, setStorageError] = useState(false);
  const active = state.tasks.find(t => t.id === state.selectedTaskId) ?? state.tasks[0];
  const condition = active.draftCondition ?? '';
  const moreNote = active.clarificationDraft ?? '';
  const setCondition = (value: string) => dispatch({ type: 'note', id: active.id, field: 'draftCondition', value });
  const entry = state.entries.find(e => e.id === state.entryId);
  const last = state.tasks.find(t => t.id === state.lastRequestId);
  const busy = operation !== null || state.scenario === 'busy';
  const loading = state.scenario === 'loading';
  const pendingCount = state.tasks.filter(t => t.status === 'pending').length;
  const startOptions = [...new Set(state.options.split('\n').map(value => value.trim()).filter(Boolean))];

  useEffect(() => {
    try { localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(state)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [state]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current.timer); pending.current = null; }, []);
  useEffect(() => { setMoreOpen(false); }, [state.selectedTaskId]);

  const navigate = (workspace: Workspace) => { setNotice(''); dispatch({ type: 'navigate', workspace }); };
  const cancelOperation = () => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null; setOperation(null); setNotice('已取消本次模拟提交，草稿仍然保留。');
    if (state.scenario === 'busy') dispatch({ type: 'scenario', scenario: 'normal' });
  };
  const simulate = (label: string, finish: () => void) => {
    if (pending.current || busy) return;
    setNotice(''); setOperation(label);
    const token = Symbol(label);
    const timer = setTimeout(() => {
      if (pending.current?.token !== token) return;
      pending.current = null; setOperation(null); finish();
    }, 650); // Explicit simulation latency, never a claim of real server progress.
    pending.current = { token, timer };
  };
  const respond = (outcome: 'answered' | 'declined' | 'conditional') => {
    const block = answerBlock(active, state.scenario);
    if (block) { setNotice(block); return; }
    if (outcome === 'conditional' && !condition.trim()) { setNotice('请写明需要先满足的条件。'); return; }
    simulate('提交回答', () => { dispatch({ type: 'respond', id: active.id, outcome, condition }); setNotice('模拟已接受回答。尚无真实服务或调用方收取这份结果。'); });
  };
  const submitStart = (event: FormEvent) => {
    event.preventDefault();
    if (state.scenario === 'offline' || state.scenario === 'error') { setNotice('尚未发出请求。输入已保留，请恢复连接后重试。'); return; }
    const id = `demo-${crypto.randomUUID().slice(0, 8)}`;
    simulate('请求判断', () => { dispatch({ type: 'scenario', scenario: 'normal' }); dispatch({ type: 'create', id }); });
  };
  const scenarioChange = (scenario: Scenario) => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null; setOperation(null); setNotice(''); dispatch({ type: 'scenario', scenario });
  };
  const readOnly = !active.authorized || active.status !== 'pending' || active.draftRevision !== undefined && active.draftRevision !== active.revision;

  return <div className="st-preview" data-theme={dark ? 'dark' : 'light'}>
    <aside className="st-sidebar">
      <a className="st-brand" href="#start" onClick={event => { event.preventDefault(); navigate('start'); }}><Torch/><span>SysTorch<small>M0 · 0.10.3 基线</small></span></a>
      <button className="st-new" onClick={() => { navigate('start'); dispatch({ type: 'input', question: '', options: state.options }); }}><Plus size={17}/> 新的判断</button>
      <nav aria-label="工作面" className="st-nav">{WORKSPACES.map((w, i) => { const Icon = [Flame, Inbox, GitBranch][i]; return <button key={w.id} aria-label={w.label} aria-current={state.workspace === w.id ? 'page' : undefined} onClick={() => navigate(w.id)}><Icon size={18}/><span>{w.label}</span>{w.id === 'desk' && <small>{pendingCount}</small>}</button>; })}</nav>
      <div className="st-sidebar-history"><span className="st-eyebrow">最近的判断</span>{state.tasks.filter(t => t.origin === 'start').slice(0, 4).map(task => <button key={task.id} onClick={() => { dispatch({ type: 'select-task', id: task.id }); navigate('desk'); }}>{task.title}</button>)}<p>请求与结果，留在同一个上下文。</p></div>
      <div className="st-sidebar-bottom"><ShieldCheck size={16}/><span>本地交互模拟<small>不会连接真实服务</small></span></div>
    </aside>

    <div className="st-body">
      <header className="st-topbar">
        <div className="st-page-title"><span className="st-mobile-brand"><Torch/></span><strong>{WORKSPACES.find(w => w.id === state.workspace)?.label}</strong><span className="st-preview-label">设计预览 · M0</span></div>
        <div className="st-top-actions"><button aria-label="深色模式" title="深色模式" aria-pressed={dark} onClick={() => setDark(value => !value)}><Moon size={17}/></button><button aria-label="预览设置与情境" aria-expanded={settingsOpen} title="预览设置与情境" onClick={() => setSettingsOpen(value => !value)}><Settings2 size={17}/></button></div>
      </header>
      <nav aria-label="移动端工作面" className="st-mobile-nav">{WORKSPACES.map(w => <button key={w.id} aria-label={w.label} aria-current={state.workspace === w.id ? 'page' : undefined} onClick={() => navigate(w.id)}>{w.label}{w.id === 'desk' && <small>{pendingCount}</small>}</button>)}</nav>
      {settingsOpen && <section className="st-controls" aria-label="预览设置"><label>预览情境<select aria-label="预览情境" value={state.scenario} onChange={e => scenarioChange(e.target.value as Scenario)}>{SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label><label>默认首页<select value={state.home} aria-label="默认首页" onChange={e => dispatch({ type: 'home', value: e.target.value as typeof state.home })}><option value="start">开始</option><option value="dashboard">仪表盘（此预览映射到协调工作台）</option><option value="last">最近一次访问</option></select></label><button className="st-text-button" onClick={() => { cancelOperation(); localStorage.removeItem(PREVIEW_STORAGE_KEY); window.location.reload(); }}>重置演示</button><span>只影响本预览；刷新可检查草稿恢复。</span></section>}
      {(state.scenario === 'offline' || storageError) && <div className="st-alert" role="status"><WifiOff size={16}/>{storageError ? '浏览器无法保存草稿；本页仍可操作，刷新前请复制内容。' : '模拟断网 · 输入仍保留，尚未接受新的提交。'}</div>}
      {notice && <div className="st-feedback" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14}/></button></div>}
      {busy && <div className="st-progress" role="status"><LoaderCircle size={15} className="st-spin"/><span>{operation ?? '提交回答'} · 模拟处理中</span><button className="st-text-button" onClick={cancelOperation}>取消本次提交</button></div>}

      <main className={`st-main st-main--${state.workspace}`}>
        {loading ? <section className="st-loading" role="status" aria-busy="true"><LoaderCircle className="st-spin"/><h2>正在读取工作区</h2><p>配置尚未确认，输入暂不可用。</p><button className="st-primary" onClick={() => scenarioChange('normal')}>完成模拟读取</button></section> : state.workspace === 'start' ? <section className="st-start">
          <div className="st-entry-picker"><label htmlFor="st-entry">当前入口</label><select id="st-entry" value={state.entryId} disabled={!state.entries.length || busy} onChange={e => dispatch({ type: 'entry', id: e.target.value })}>{!state.entries.length && <option value="">尚未配置</option>}{state.entries.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select><span className="st-source-label">{entry?.source === 'human' ? '人工来源' : entry?.local ? '本地来源' : '模型来源'} · 模拟</span></div>
          {!state.entries.length ? <div className="st-empty"><GitBranch size={30}/><h1>先连接一个判断来源</h1><p>配置入口后，就能在这里直接开始。也可以先用演示了解一次完整判断。</p><div><button className="st-primary" onClick={() => navigate('coordinate')}>配置演示入口 <ArrowRight size={15}/></button><button className="st-secondary" onClick={() => scenarioChange('normal')}>使用模拟样例</button></div></div> : <>
            <div className="st-start-lead"><h1>把眼前的问题，<br/>变成下一步。</h1><p>写下要判断的事，列出选择。把结果交给你。</p></div>
            <div className="st-templates" aria-label="问题模板">{[
              ['安排下一步', '接下来的 45 分钟先做什么？', '整理资料\n完成演示'],
              ['比较两个方案', '哪个方案更适合今天完成？', '方案 A：范围小、今天可用\n方案 B：功能多、需要两天'],
              ['做一个判断', '现在适合发送这份草稿吗？', '发送\n再检查一次'],
            ].map(([label, question, options]) => <button key={label} disabled={busy} onClick={() => dispatch({ type: 'input', question, options })}>{label}<ArrowDown size={13}/></button>)}</div>
            {entry && !entry.ready && <div className="st-service-notice"><span><strong>本地服务尚未启动</strong><small>不会改走其他来源。启动反馈与可用状态分别显示。</small></span><button className="st-secondary" disabled={busy} onClick={() => simulate('启动本地来源', () => { dispatch({ type: 'service-state', id: entry.id, running: true }); dispatch({ type: 'scenario', scenario: 'normal' }); setNotice('模拟服务已就绪，没有执行主机命令。'); })}>模拟启动服务</button></div>}
            <form className="st-composer" onSubmit={submitStart} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !event.repeat) { event.preventDefault(); if ((event.target as HTMLElement).id !== 'st-more-note') event.currentTarget.requestSubmit(); } }}>
              <label htmlFor="st-question">你现在想判断什么？</label><textarea id="st-question" rows={3} value={state.question} placeholder="例如：接下来的 45 分钟先做什么？" disabled={busy} onChange={e => dispatch({ type: 'input', question: e.target.value, options: state.options })}/>
              <div className="st-candidates"><label htmlFor="st-options">候选选项 <small>每行一个</small></label><textarea id="st-options" rows={2} value={state.options} disabled={busy} onChange={e => dispatch({ type: 'input', question: state.question, options: e.target.value })}/></div>
              <div className="st-composer-footer"><span><ShieldCheck size={13}/> M0 模拟，不发送真实请求</span><button className="st-primary" type="submit" disabled={busy || !state.question.trim() || startOptions.length < 2 || !entry?.ready}>{busy ? <LoaderCircle size={16} className="st-spin"/> : <Send size={15}/>} 请求判断</button></div>
            </form>
            {last && <article className="st-start-result" aria-label="最近判断结果"><div><span className="st-eyebrow">{last.status === 'pending' ? '等待你的判断' : '本次判断 · 模拟'}</span><h2>{last.status === 'pending' ? last.title : last.answer}</h2><p>{last.status === 'pending' ? '同一请求已经出现在决策台。切换工作面不会丢掉上下文。' : '这是交互样例中的固定结果，不代表模型实际推理。'}</p></div><button className="st-text-button" onClick={() => { dispatch({ type: 'select-task', id: last.id }); navigate('desk'); }}>查看{last.status === 'pending' ? '并作答' : '依据'} <ArrowRight size={15}/></button></article>}
          </>}
        </section> : state.workspace === 'desk' ? <div className="st-desk">
          <aside className="st-task-list" aria-label="判断请求"><button className="st-task-toggle" aria-expanded={tasksOpen} onClick={() => setTasksOpen(value => !value)}>判断请求 · {state.tasks.length}<span>切换问题 <ChevronDown size={13}/></span></button><div className="st-task-rows" data-open={tasksOpen}><div className="st-list-heading"><strong>判断请求</strong><span>{state.tasks.length}</span></div>{state.tasks.map(task => <button key={task.id} className="st-task-row" aria-pressed={task.id === active.id} onClick={() => { setNotice(''); setTasksOpen(false); dispatch({ type: 'select-task', id: task.id }); }}><span className="st-task-caller">{task.caller}</span><strong>{task.title}</strong><TaskStatus task={task}/>{task.draft && task.status === 'pending' && <span className="st-draft-label">有草稿</span>}</button>)}</div></aside>
          <article className="st-task-detail">
            <header className="st-task-header"><div><span className="st-eyebrow">{active.caller}</span><h1>{active.title}</h1></div><TaskStatus task={active}/></header>
            <div className="st-task-meta"><span><UserRound size={13}/> {active.authorized ? '由你判断' : '无作答权限'}</span><span>修订 {active.revision}</span><code>{active.id}</code></div>
            <section className="st-context-section"><h2>先了解这些</h2><ContextValue value={active.context}/></section>
            {active.origin === 'experiment' && active.status === 'pending' && <div className="st-blind"><ShieldCheck size={16}/> 独立作答 · 模型答案在提交前保持隐藏。</div>}
            {answerBlock(active, state.scenario) && <div className="st-task-notice" role="status">{answerBlock(active, state.scenario)}{active.draftRevision !== undefined && active.draftRevision !== active.revision && <button className="st-text-button" onClick={() => dispatch({ type: 'latest', id: active.id })}>查看最新结果</button>}</div>}
            {active.status === 'pending' ? <form className="st-answer-form" onSubmit={event => { event.preventDefault(); respond(condition.trim() ? 'conditional' : 'answered'); }} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !event.repeat) { event.preventDefault(); if ((event.target as HTMLElement).id !== 'st-more-note') event.currentTarget.requestSubmit(); } }}>
              <fieldset disabled={readOnly || busy}><legend>你的选择</legend>{active.options.map((option, index) => <label className="st-option" key={option}><input type="radio" name={`choice-${active.id}`} value={option} checked={active.draft === option} onChange={() => dispatch({ type: 'choose', id: active.id, value: option })}/><span className="st-option-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span>{active.draft === option && <Check size={17}/>}</label>)}</fieldset>
              <details className="st-answer-extra"><summary>附条件回答或补充说明 <ChevronDown size={13}/></summary><label htmlFor="st-condition">需要先满足什么条件？</label><textarea id="st-condition" rows={2} value={condition} disabled={readOnly || busy} onChange={e => setCondition(e.target.value)} placeholder="例如：先确认录制内容没有私人信息"/></details>
              <div className="st-answer-actions"><span>{active.draft ? '选择已留为本地草稿，尚未提交' : '选中不会自动提交'}</span><button className="st-primary" type="submit" disabled={readOnly || busy || !active.draft}>{busy ? <LoaderCircle size={16} className="st-spin"/> : <Check size={16}/>} 提交回答</button></div>
              <div className="st-secondary-actions"><button type="button" disabled={readOnly || busy} onClick={() => { setMoreOpen(value => !value); }}>需要更多信息</button><button type="button" disabled={readOnly || busy} onClick={() => respond('declined')}>拒绝作答</button></div>
              {moreOpen && <div className="st-more"><label htmlFor="st-more-note">请调用方补充什么？</label><textarea id="st-more-note" value={moreNote} onChange={e => dispatch({ type: 'note', id: active.id, field: 'clarificationDraft', value: e.target.value })} rows={2}/><button type="button" className="st-secondary" disabled={!moreNote.trim() || busy || readOnly} onClick={() => { dispatch({ type: 'revise', id: active.id, note: moreNote.trim() }); setMoreOpen(false); setCondition(''); setNotice('模拟请求已修订，旧选择已清除。尚未通知真实调用方。'); }}>模拟请求补充</button></div>}
            </form> : <section className="st-answer-result"><span className="st-eyebrow">{active.outcome === 'declined' ? '未提供业务答案' : active.status === 'completed' ? '原始人工观察 / 模拟结果' : '请求已结束'}</span><h2>{active.answer ?? (active.status === 'expired' ? '过期后不接受旧答案' : active.status === 'cancelled' ? '已取消这条请求' : '拒绝作答')}</h2>{active.condition && <p className="st-condition-result">条件：{active.condition}<br/><small>严格协议不能表达条件时，应停止投影，而不是当作无条件同意。</small></p>}<p className="st-receipt"><CheckCheck size={16}/> 本预览已记录 · 没有真实调用方确认收取</p></section>}
            <details className="st-evidence"><summary><CircleHelp size={14}/> 请求、来源与结果依据 <ChevronDown size={13}/></summary><dl><div><dt>请求 ID</dt><dd><code>{active.id}</code></dd></div><div><dt>观察来源</dt><dd>本浏览器模拟操作，不等于真实人工授权</dd></div><div><dt>兼容编码</dt><dd>本原型未生成概率或 confidence</dd></div><div><dt>上下文修订</dt><dd>{active.revision} · 旧修订不能批准新对象</dd></div></dl><details><summary>查看原始上下文 JSON</summary><pre>{JSON.stringify(active.context, null, 2)}</pre></details></details>
            {active.origin === 'experiment' && active.status === 'completed' && <button className="st-text-button" onClick={() => { navigate('coordinate'); setNotice('已返回样本 03。独立人工观察已保留，比较数据仍是模拟。'); }}><ArrowLeft size={15}/> 返回人机比较 · 样本 03</button>}
          </article>
        </div> : <section className="st-coordinate">
          <div className="st-section-heading"><div><span className="st-eyebrow">让每个问题找到合适的来源</span><h1>入口、路径与判断来源</h1></div><span className="st-status"><GitBranch size={14}/> 配置演示</span></div>
          {!state.entries.length ? <form className="st-entry-form" onSubmit={event => { event.preventDefault(); if (entryLabel.trim()) dispatch({ type: 'add-entry', label: entryLabel.trim() }); }}><h2>配置第一个演示入口</h2><label htmlFor="st-new-entry">入口名称</label><input id="st-new-entry" value={entryLabel} onChange={e => setEntryLabel(e.target.value)} required/><p>这里只创建模拟入口。真实地址与凭据将使用原有提供商配置流程，不在原型中收集。</p><button className="st-primary" type="submit">保存模拟入口并开始 <ArrowRight size={15}/></button></form> : <>
            <CoreWorkbench session={coreSession.current}/>
            <div className="st-coordinator-lower"><section><div className="st-section-heading"><h2>判断来源</h2><small>全部为模拟状态</small></div>{state.entries.map(source => <div className="st-source-row" key={source.id}><span className={`st-dot ${source.ready ? 'st-dot--ready' : ''}`}/><span><strong>{source.label}</strong><small>{source.source === 'human' ? '人工来源' : source.local ? '本地模型' : '远端模型'}</small></span><span className="st-source-state">{source.ready ? source.source === 'human' ? '可接收' : '可用' : '未启动'}</span>{source.local && source.source === 'model' && <button className="st-text-button" disabled={busy} onClick={() => simulate(source.ready ? '停止来源' : '启动来源', () => dispatch({ type: 'service-state', id: source.id, running: !source.ready }))}>{source.ready ? '模拟停止' : '模拟启动'}</button>}</div>)}</section><section><div className="st-section-heading"><h2>人机比较</h2><small>样本 03</small></div><p>先独立判断，再对照不同来源。辅助作答与独立观察分别记录。</p><div className="st-comparison"><div><UserRound size={16}/><span>人工观察</span><strong>{state.tasks.find(t => t.id === 'demo-1040')?.answer ?? '等待判断'}</strong></div><div><Columns3 size={16}/><span>模型样例</span><strong>{state.tasks.find(t => t.id === 'demo-1040')?.status === 'completed' ? '判断，从这里开始' : '盲答期间隐藏'}</strong></div></div><button className="st-secondary" onClick={() => { dispatch({ type: 'select-task', id: 'demo-1040' }); navigate('desk'); }}>前往决策台作答 <ArrowRight size={15}/></button></section></div>
            <section className="st-existing-tools" aria-label="保留的专业功能"><div className="st-section-heading"><h2>专业工作台</h2><small>原有能力继续保留</small></div><p>另开现有 SysTorch 控制台，使用其网关配置；本页仍是模拟预览。</p><nav aria-label="现有控制台功能">{[
              ['providers', '提供商与服务启停'], ['routing', '完整 DAG 与实时辉光'], ['endpoints', '入口与路由策略'], ['stats', '调用历史与统计'], ['playground', '演练场与批量比较'], ['dashboard', '仪表盘与自定义布局'], ['settings', '全局设置'],
            ].map(([path, label]) => <a key={path} href={`/#/${path}`} target="_blank" rel="noopener noreferrer">{label} <ArrowRight size={13}/></a>)}</nav></section>
            <details className="st-evidence"><summary><GitBranch size={14}/> 查看本次路径和协议边界 <ChevronDown size={13}/></summary><ol><li>调用者提交问题：尚未接通真实 API。</li><li>协调服务持久接收与恢复：M1 待实现。</li><li>人工回答、兼容投影与调用方查询：本次只预览操作与状态。</li></ol><p>现有 SysTorch 的提供商、入口、DAG、演练场与统计继续保留；此预览没有替换生产工作台。</p></details>
          </>}
        </section>}
      </main>
      <footer className="st-footer"><span><span className="st-dot"/> 模拟数据 · 仅本浏览器保存</span><span>SysTorch M0 · 未接入持久决策 API</span></footer>
    </div>
  </div>;
}
