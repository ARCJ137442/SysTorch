import type { RouteEdge } from '../generated/RouteEdge';
import type { RouteMutation } from '../generated/RouteMutation';

export interface Route {
  left: string;
  match: 'exact' | 'prefix';
  right: string;
  upstream_model?: string | null;
  priority: number;
  sticky?: 'none' | 'session';
  on_error?: 'next' | 'fail';
}

export function normalizeRoute(route: Route): Route {
  return {
    left: route.left, right: route.right, match: route.match === 'prefix' ? 'prefix' : 'exact',
    ...(route.upstream_model ? { upstream_model: route.upstream_model } : {}),
    priority: Number.isFinite(route.priority) ? route.priority : 10,
    sticky: route.sticky ?? 'none', on_error: route.on_error ?? 'next',
  };
}

export function routeEdgeId(route: Route): string {
  return JSON.stringify([route.left, route.right, route.match, route.upstream_model || null]);
}

function wireRoute(route: Route): RouteEdge {
  const normalized = normalizeRoute(route);
  return { ...normalized, upstream_model: normalized.upstream_model ?? null, sticky: normalized.sticky!, on_error: normalized.on_error! };
}

function sameRoute(a: Route, b: Route): boolean {
  return JSON.stringify(normalizeRoute(a)) === JSON.stringify(normalizeRoute(b));
}

/** Only differences from the editor's own baseline are user intent. Never diff
 * a stale draft against a freshly fetched whole table: that deletes others' work. */
export function planRouteEdits({ baseline, routes }: { baseline: Route[]; routes: Route[] }): RouteMutation[] {
  const previous = new Map(baseline.map(route => [routeEdgeId(route), route]));
  const next = new Map(routes.map(route => [routeEdgeId(route), route]));
  const operations: RouteMutation[] = [];
  for (const [id, route] of previous) {
    if (!next.has(id)) operations.push({ op: 'delete', edge_id: id, expected: wireRoute(route) });
  }
  for (const [id, route] of next) {
    const old = previous.get(id);
    if (!old) operations.push({ op: 'create', route: wireRoute(route) });
    else if (!sameRoute(old, route)) operations.push({ op: 'update', edge_id: id, route: wireRoute(route), expected: wireRoute(old) });
  }
  return operations;
}

/** Used by the mock transport and by draft rebasing. Build a private result so
 * failed operations never partially modify the caller's table. */
export function applyRouteEdits(current: Route[], operations: RouteMutation[]): Route[] {
  const next = new Map(current.map(route => [routeEdgeId(route), normalizeRoute(route)]));
  for (const operation of operations) {
    const id = operation.op === 'create' ? routeEdgeId(operation.route) : operation.edge_id;
    const old = next.get(id);
    if (operation.op === 'create') {
      if (old) throw new Error('Route already exists. Refresh before retrying.');
      next.set(id, normalizeRoute(operation.route));
    } else {
      if (!old || (operation.expected && !sameRoute(old, operation.expected))) throw new Error('Route changed in another session. Refresh before retrying.');
      next.delete(id);
      if (operation.op === 'update') {
        const newId = routeEdgeId(operation.route);
        if (next.has(newId)) throw new Error('Route already exists. Refresh before retrying.');
        next.set(newId, normalizeRoute(operation.route));
      }
    }
  }
  return [...next.values()];
}

/** Preserve newer local edits (and undo history) while importing untouched
 * server changes from the transaction receipt. No second whole-table write. */
export function mergeAcknowledgedRoutes({ submitted, local, acknowledged }: { submitted: Route[]; local: Route[]; acknowledged: Route[] }): Route[] {
  return applyRouteEdits(acknowledged, planRouteEdits({ baseline: submitted, routes: local }));
}

/** A receipt may overlap edits made after dispatch. Preserve those edits and
 * their old preconditions on conflict; never silently re-authorize them against
 * the newer server value. Unrelated remote changes still enter the document. */
export function reconcileRouteReceipt(input: { submitted: Route[]; local: Route[]; acknowledged: Route[] }): { routes: Route[]; baseline: Route[]; conflicts: string[] } {
  const operations = planRouteEdits({ baseline: input.submitted, routes: input.local });
  const basis = new Map(input.acknowledged.map(route => [routeEdgeId(route), route]));
  const remaining: RouteMutation[] = [];
  const conflicts: string[] = [];
  for (const operation of operations) {
    const id = operation.op === 'create' ? routeEdgeId(operation.route) : operation.edge_id;
    const remote = basis.get(id);
    if (operation.op === 'delete' && !remote) continue;
    if (operation.op !== 'delete' && remote && sameRoute(remote, operation.route)) continue;
    const conflict = operation.op === 'create' ? !!remote : !remote || !!operation.expected && !sameRoute(remote, operation.expected);
    if (conflict) {
      conflicts.push(id);
      if (operation.op === 'create') basis.delete(id);
      else if (operation.expected) basis.set(id, normalizeRoute(operation.expected));
    }
    remaining.push(operation);
  }
  const baseline = [...basis.values()];
  return { routes: applyRouteEdits(baseline, remaining), baseline, conflicts };
}

/** Only server changes outside the submitted intent are overlaid on old undo
 * snapshots. They cannot become an accidental inverse edit on the next undo. */
export function rebaseRouteHistory(input: { submitted: Route[]; historical: Route[]; acknowledged: Route[] }): Route[] {
  const rows = new Map(input.historical.map(route => [routeEdgeId(route), route]));
  for (const operation of planRouteEdits({ baseline: input.submitted, routes: input.acknowledged })) {
    if (operation.op !== 'create') rows.delete(operation.edge_id);
    if (operation.op !== 'delete') rows.set(routeEdgeId(operation.route), normalizeRoute(operation.route));
  }
  return [...rows.values()];
}

export function routeEditsAcknowledged(routes: Route[], operations: RouteMutation[]): boolean {
  const byId = new Map(routes.map(route => [routeEdgeId(route), route]));
  return operations.every(operation => operation.op === 'delete'
    ? !byId.has(operation.edge_id)
    : !!byId.get(routeEdgeId(operation.route)) && sameRoute(byId.get(routeEdgeId(operation.route))!, operation.route));
}
