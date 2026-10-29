import { useEffect, useReducer, useState } from 'react';
import { Check, Play, Redo2, Undo2, X } from 'lucide-react';
import { findCyclicEdgeKeys } from '../../api/admin';
import { I18nProvider } from '../../i18n';
import { DagCanvas } from '../../components/routing/DagCanvas';
import { DocumentHistory } from '../../components/routing/documentHistory';
import { routeIdentity, type Point } from '../../components/routing/dag';
import { normalizeRoute, type Route } from '../../api/routeEdits';
import { advanceRouteActivities, applyRouteActivityEvent, nextRouteActivityUpdateDelay, type RouteActivityState } from '../../pages/routingActivity';

interface GraphDraft { routes: Route[]; positions: Record<string, Point> }
export interface CorePreviewSession {
  history: DocumentHistory<GraphDraft>;
  activities: RouteActivityState;
  requestSequence: number;
  pending: number[];
}

export function createCorePreviewSession(): CorePreviewSession {
  return {
    history: new DocumentHistory({ routes: [
      normalizeRoute({ left: 'daily-decision', right: 'priority-route', match: 'exact', priority: 10 }),
      normalizeRoute({ left: 'priority-route', right: 'remote-model', match: 'exact', upstream_model: 'sys1-demo', priority: 10 }),
      normalizeRoute({ left: 'priority-route', right: 'local-model', match: 'exact', upstream_model: 'local-demo', priority: 20 }),
    ], positions: {} }), activities: {}, requestSequence: 0, pending: [],
  };
}

/** Reuse the actual DAG, port editing and neon renderer. Only the event source
 * and save sink are simulated. The parent owns this session across page changes;
 * source timestamps survive remounts, so old responses cannot pulse again. */
export function CoreWorkbench({ session }: { session: CorePreviewSession }) {
  const [, redraw] = useReducer(n => n + 1, 0);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [message, setMessage] = useState('');
  const document = session.history.current;
  const change = (next: GraphDraft) => {
    if (findCyclicEdgeKeys(next.routes).length) { setMessage('这次编辑会产生环路，未应用。'); return; }
    if (new Set(next.routes.map(routeIdentity)).size !== next.routes.length) { setMessage('连线已存在，未重复添加。'); return; }
    setMessage(''); session.history.push(next); redraw();
  };
  useEffect(() => {
    const delay = nextRouteActivityUpdateDelay(session.activities, now);
    if (delay === null) return;
    const timer = setTimeout(() => {
      const at = Date.now(); session.activities = advanceRouteActivities(session.activities, at); setNow(at);
    }, delay);
    return () => clearTimeout(timer);
  }, [session, session.activities, now]);
  const event = (phase: string, id: number) => {
    const at = Date.now();
    session.activities = applyRouteActivityEvent(session.activities, document.routes, {
      kind: 'route_activity', id, detail: JSON.stringify({ phase, activity_id: `m0-${id}`, requested_model: 'daily-decision', provider_id: 'remote-model', upstream_model: 'sys1-demo', route_edges: document.routes.filter(r => r.right !== 'local-model') }),
    }, at);
    setNow(at); redraw();
  };
  const start = () => { const id = ++session.requestSequence; session.pending.push(id); event('started', id); };
  const finish = (success: boolean) => {
    const id = session.pending.shift();
    if (id !== undefined) event(success ? 'finished_success' : 'finished_failure', id);
  };
  return <section className="st-core-workbench" aria-label="保留的 DAG 路由工作台">
    <div className="st-section-heading"><div><h2>路由图</h2><small>可编辑节点、端口与连线 · 沿用原有 DAG 与辉光</small></div><span className="st-preview-label">事件与保存均为模拟</span></div>
    <div className="st-core-actions">
      <button className="st-secondary" onClick={start}><Play size={13}/> 模拟请求</button>
      <button className="st-secondary" disabled={!session.pending.length} onClick={() => finish(true)}><Check size={13}/> 模拟成功响应</button>
      <button className="st-secondary" disabled={!session.pending.length} onClick={() => finish(false)}><X size={13}/> 模拟失败响应</button>
      <span role="status">{session.pending.length} 个模拟请求等待响应</span>
      <button className="st-text-button" disabled={!session.history.canUndo} onClick={() => { session.history.undo(); redraw(); }} aria-label="撤销图编辑"><Undo2 size={15}/></button>
      <button className="st-text-button" disabled={!session.history.canRedo} onClick={() => { session.history.redo(); redraw(); }} aria-label="重做图编辑"><Redo2 size={15}/></button>
    </div>
    <div className="st-core-canvas"><I18nProvider><DagCanvas
      routes={document.routes} positions={document.positions}
      entries={[{ id: 'daily-decision', enabled: true, strategy: 'failover' }]}
      providers={[{ id: 'remote-model', name: '远端模型 · 演示', enabled: true, models: ['sys1-demo'] }, { id: 'local-model', name: '本地模型 · 演示', enabled: true, models: ['local-demo'] }]}
      selected={selected} selectedNode={selectedNode} errors={new Set()}
      routeActivities={session.activities} activityNow={now}
      onSelect={setSelected} onSelectNode={setSelectedNode}
      onNodeDoubleClick={node => setMessage(`${node.id} · 此处是模拟图；真实提供商启停继续使用原有提供商管理。`)}
      onCreate={(left, right, model) => {
        const route = normalizeRoute({ left, right, upstream_model: model, match: 'exact', priority: 30 });
        if (!document.routes.some(r => routeIdentity(r) === routeIdentity(route))) change({ ...document, routes: [...document.routes, route] });
      }}
      onPatch={(key, patch) => change({ ...document, routes: document.routes.map(r => routeIdentity(r) === key ? normalizeRoute({ ...r, ...patch }) : r) })}
      onDelete={key => { change({ ...document, routes: document.routes.filter(r => routeIdentity(r) !== key) }); setSelected(null); }}
      onDeleteNode={id => change({ ...document, routes: document.routes.filter(r => r.left !== id && r.right !== id) })}
      onInsertNode={(key, id) => {
        if (!id || document.routes.some(r => r.left === id || r.right === id)) return;
        change({ ...document, routes: document.routes.flatMap(r => routeIdentity(r) !== key ? [r] : [{ ...r, right: id, upstream_model: undefined }, { ...r, left: id, match: 'exact' as const }]) });
      }}
      onMove={(id, point) => change({ ...document, positions: { ...document.positions, [id]: point } })}
      onResetLayout={() => change({ ...document, positions: {} })}
    /></I18nProvider></div>
    {message && <p role="status">{message}</p>}
    <p className="st-core-footnote">连线随请求变亮，响应产生辉光并淡出。切换工作面不会把旧响应重新播放。此处演示连线反馈；真实网关调度、模型启停与调用记录保持原有实现。</p>
  </section>;
}
