import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const { planRouteEdits, applyRouteEdits, mergeAcknowledgedRoutes, normalizeRoute, routeEditsAcknowledged } = await loadTs('../src/api/routeEdits.ts');
const { reconcileRouteReceipt, rebaseRouteHistory } = await loadTs('../src/api/routeEdits.ts');
const { DocumentHistory } = await loadTs('../src/components/routing/documentHistory.ts');
const edge = (left, priority = 10) => normalizeRoute({ left, right: 'provider', match: 'exact', priority });

test('stale editor saves only its own edits and preserves a concurrently created edge', () => {
  const baseline = [edge('a')];
  const operations = planRouteEdits({ baseline, routes: [edge('a', 20)] });
  const receipt = applyRouteEdits([...baseline, edge('b')], operations);
  assert.deepEqual(receipt, [edge('b'), edge('a', 20)]);
  assert.equal(operations.length, 1);
  assert.equal(operations[0].op, 'update');
  assert.equal(routeEditsAcknowledged(receipt, operations), true, 'unrelated server edges are not a save mismatch');
});

test('same-edge update or deletion conflicts, leaves the original table unchanged', () => {
  for (const routes of [[edge('a', 20)], []]) {
    const operations = planRouteEdits({ baseline: [edge('a')], routes });
    const remote = [edge('a', 99), edge('b')];
    assert.throws(() => applyRouteEdits(remote, operations), /changed/);
    assert.deepEqual(remote, [edge('a', 99), edge('b')]);
  }
});

test('a multi-edge transaction fails without applying preceding mutations', () => {
  const remote = [edge('a', 99)];
  const operations = planRouteEdits({ baseline: [edge('a')], routes: [edge('b'), edge('a', 20)] });
  assert.throws(() => applyRouteEdits(remote, operations));
  assert.deepEqual(remote, [edge('a', 99)]);
});

test('receipt rebase preserves later edits and remote additions through undo and redo', () => {
  const history = new DocumentHistory([edge('a')]);
  history.push([edge('a', 20)]);
  const submitted = history.current;
  history.push([edge('a', 30)]); // edit while the save is in flight
  const acknowledged = [edge('a', 20), edge('b')];
  history.rebase(local => mergeAcknowledgedRoutes({ submitted, local, acknowledged }));
  assert.deepEqual(new Map(history.current.map(r => [r.left, r.priority])), new Map([['a', 30], ['b', 10]]));
  for (const value of [history.undo(), history.undo(), history.redo(), history.redo()]) assert(value.some(r => r.left === 'b'));
});

test('route model ports and default values retain stable independent identities', () => {
  const a = { ...edge('a'), upstream_model: 'M1' };
  const b = { ...edge('a'), upstream_model: 'M2' };
  const operations = planRouteEdits({ baseline: [a, b], routes: [{ ...a, priority: 11 }, b] });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].route.upstream_model, 'M1');
  assert.deepEqual(planRouteEdits({ baseline: [edge('a')], routes: [{ left: 'a', right: 'provider', match: 'exact', priority: 10 }] }), []);
});

test('a remote edit to an untouched edge cannot be undone through stale history', () => {
  const submitted = [edge('a'), edge('ours')];
  const acknowledged = [edge('a', 99), edge('ours'), edge('remote')];
  const historical = [edge('a', 20)];
  const rebased = rebaseRouteHistory({ submitted, historical, acknowledged });
  assert.equal(rebased.find(r => r.left === 'a').priority, 99);
  assert(rebased.some(r => r.left === 'remote'));
  assert(!rebased.some(r => r.left === 'ours'), 'undo still reverses our own addition');
});

test('a late local edit conflicting with the receipt keeps its original precondition', () => {
  const submitted = [edge('a'), edge('ours')];
  const local = [edge('a', 20), edge('ours')];
  const acknowledged = [edge('a', 99), edge('ours'), edge('remote')];
  const result = reconcileRouteReceipt({ submitted, local, acknowledged });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.routes.find(r => r.left === 'a').priority, 20, 'keep the user draft');
  assert.equal(result.baseline.find(r => r.left === 'a').priority, 10, 'do not silently authorize overwriting remote priority 99');
  assert(result.routes.some(r => r.left === 'remote'));
  assert.throws(() => applyRouteEdits(acknowledged, planRouteEdits(result)), /changed/);
});
