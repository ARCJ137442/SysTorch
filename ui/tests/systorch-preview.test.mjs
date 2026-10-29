import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const { initialPreview, previewReducer: reduce, restorePreview, answerBlock, SCENARIOS } = await loadTs('../src/prototypes/systorch/model.ts');

test('preview preserves selection and annotations across navigation and reload', () => {
  let state = initialPreview();
  state = reduce(state, { type: 'choose', id: 'demo-1042', value: '先完成演示' });
  state = reduce(state, { type: 'note', id: 'demo-1042', field: 'draftCondition', value: '先检查隐私' });
  state = reduce(state, { type: 'navigate', workspace: 'coordinate' });
  state = reduce(state, { type: 'home', value: 'last' });
  const restored = restorePreview(JSON.stringify(state));
  assert.equal(restored.workspace, 'coordinate');
  assert.equal(restored.tasks[0].draft, '先完成演示');
  assert.equal(restored.tasks[0].draftCondition, '先检查隐私');
  assert.equal(restored.tasks[0].status, 'pending', 'selecting must not submit');
});

test('offline, expired, completed, permission and stale revision cannot accept a new answer', () => {
  for (const scenario of ['offline', 'expired', 'conflict', 'permission', 'declined']) {
    let state = reduce(initialPreview(), { type: 'scenario', scenario });
    const before = structuredClone(state.tasks[0]);
    state = reduce(state, { type: 'respond', id: before.id, outcome: 'answered' });
    assert.deepEqual(state.tasks[0], before, scenario);
    assert(answerBlock(before, scenario));
  }
});

test('clarification invalidates old draft and is distinct from conditional approval', () => {
  let state = reduce(initialPreview(), { type: 'choose', id: 'demo-1042', value: '先完成演示' });
  state = reduce(state, { type: 'revise', id: 'demo-1042', note: '需要确认可分享范围' });
  assert.equal(state.tasks[0].revision, 2);
  assert.equal(state.tasks[0].draft, undefined);
  assert.equal(state.tasks[0].status, 'pending');
  assert.equal(state.tasks[0].answer, undefined);
});

test('refusal does not invent a business answer; duplicate acceptance does not overwrite', () => {
  let state = reduce(initialPreview(), { type: 'respond', id: 'demo-1042', outcome: 'declined' });
  assert.equal(state.tasks[0].outcome, 'declined');
  assert.equal(state.tasks[0].answer, undefined);
  const accepted = structuredClone(state.tasks[0]);
  state = reduce(state, { type: 'respond', id: 'demo-1042', outcome: 'answered' });
  assert.deepEqual(state.tasks[0], accepted);
});

test('all preview scenarios restore safely and transient work is not replayed', () => {
  for (const scenario of SCENARIOS) {
    const state = reduce(initialPreview(), { type: 'scenario', scenario: scenario.id });
    assert(restorePreview(JSON.stringify(state)).tasks.length);
  }
  assert.equal(restorePreview(JSON.stringify(reduce(initialPreview(), { type: 'scenario', scenario: 'busy' }))).scenario, 'normal');
  assert.deepEqual(restorePreview('{bad'), initialPreview());
  assert.deepEqual(restorePreview(JSON.stringify({ ...initialPreview(), tasks: [] })), initialPreview());
});

test('stopped local service cannot silently choose a different model source', () => {
  let state = reduce(initialPreview(), { type: 'scenario', scenario: 'local-stopped' });
  state = reduce(state, { type: 'input', question: '选哪一个？', options: 'A\nB' });
  const before = state.tasks.length;
  state = reduce(state, { type: 'create', id: 'demo-new' });
  assert.equal(state.tasks.length, before);
  assert.equal(state.entryId, 'local');
});
