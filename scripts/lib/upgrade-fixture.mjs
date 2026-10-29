import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const fingerprint = value => createHash('sha256').update(value).digest('hex');
export const preferences = {jev_lang: 'en', jev_theme: 'dark', jev_ui_scale: '1.37', jev_show_status_bar: 'false'};
const root = '/v1/systorch/decisions';

export function gatewayClient(base) {
  return async (path, {token, body, method = body === undefined ? 'GET' : 'POST'} = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    return {status: response.status, data: text ? JSON.parse(text) : null};
  };
}

export async function seedUpgradeFixture(api, owner) {
  const created = await api('/v1/admin/tokens', {body: {name: 'upgrade-fixture-caller', role: 'readonly'}});
  assert.equal(created.status, 200);
  const caller = created.data.secret;
  const request = key => ({entry: 'human:owner', idempotency_key: `upgrade-${key}`, question: `Upgrade fixture: ${key}`, context: {source: 'synthetic migration fixture'}, choices: [{id: 'approve', label: 'Finish migration verification'}, {id: 'defer', label: 'Keep waiting'}], ttl_seconds: key === 'expiring' ? 1 : 3600});
  const tasks = {};
  for (const key of ['waiting', 'answered', 'cancelled', 'erased', 'expiring']) {
    const accepted = await api(root, {token: caller, body: request(key)});
    assert.equal(accepted.status, 202);
    tasks[key] = accepted.data.id;
  }
  assert.equal((await api(`${root}/${tasks.answered}/answers`, {token: owner, body: {revision: 1, observation: {kind: 'answered', choice_id: 'approve', note: 'Saved by the old M1 app'}}})).status, 200);
  for (const key of ['cancelled', 'erased']) assert.equal((await api(`${root}/${tasks[key]}/cancel`, {token: caller, body: {}})).status, 200);
  assert.equal((await api(`${root}/${tasks.erased}`, {token: caller, method: 'DELETE'})).status, 204);
  const provider = {id: 'upgrade-fixture', kind: 'typesafe', base: 'http://127.0.0.1:9/v1/systemone', enabled: false, models: ['upgrade-model'], api_key: 'synthetic-unused-fixture-key', lifecycle: {controllable: false, process_policy: 'persistent', mode: 'manual', program: 'fixture-service', args: ['start'], stop_program: 'fixture-service', stop_args: ['stop'], status_program: 'fixture-service', status_args: ['status'], timeout_ms: 1500, readiness_timeout_ms: 1500, inject_api_key: false}};
  assert.equal((await api('/v1/admin/providers/upgrade-fixture', {method: 'PUT', body: provider})).status, 200);
  const edge = {left: 'upgrade-entry', right: 'upgrade-fixture', upstream_model: 'upgrade-model', priority: 42};
  const routed = await api('/v1/admin/routes/transaction', {body: {operations: [{op: 'create', route: edge}]}});
  assert.equal(routed.status, 200);
  const providers = (await api('/v1/admin/providers')).data;
  const routes = (await api('/v1/admin/routes')).data;
  const lifecycle = (await api('/v1/admin/providers/upgrade-fixture/lifecycle')).data.command;
  const answered = (await api(`${root}/${tasks.answered}`, {token: caller})).data;
  const strictResult = (await api(`${root}/${tasks.answered}/result`, {token: caller})).data;
  return {caller, ownerFingerprint: fingerprint(owner), tasks, requests: Object.fromEntries(Object.keys(tasks).map(key => [key, request(key)])), providers, routes, lifecycle, answered, strictResult};
}

export async function assertUpgradeFixture(api, fixture, owner, page, {answerPending} = {}) {
  assert.equal(fingerprint(owner), fixture.ownerFingerprint, 'owner authority must survive the update');
  for (const key of ['waiting', 'answered', 'cancelled']) {
    const read = await api(`${root}/${fixture.tasks[key]}`, {token: fixture.caller});
    assert.equal(read.status, 200, 'the same caller token still owns its old task');
    assert.equal(read.data.status, {waiting: 'pending', answered: 'completed', cancelled: 'cancelled'}[key]);
  }
  assert.deepEqual((await api(`${root}/${fixture.tasks.answered}`, {token: fixture.caller})).data, fixture.answered);
  assert.deepEqual((await api(`${root}/${fixture.tasks.answered}/result`, {token: fixture.caller})).data, fixture.strictResult);
  assert.equal((await api(`${root}/${fixture.tasks.expiring}/result`, {token: fixture.caller})).status, 410);
  assert.equal((await api(root, {token: fixture.caller, body: fixture.requests.erased})).status, 410, 'an erased idempotency tombstone must not resurrect');
  const repeated = await api(root, {token: fixture.caller, body: fixture.requests.waiting});
  assert.equal(repeated.status, 200); assert.equal(repeated.data.id, fixture.tasks.waiting);
  assert.deepEqual((await api('/v1/admin/providers')).data, fixture.providers);
  assert.deepEqual((await api('/v1/admin/routes')).data, fixture.routes);
  assert.deepEqual((await api('/v1/admin/providers/upgrade-fixture/lifecycle')).data.command, fixture.lifecycle);
  for (const [key, value] of Object.entries(preferences)) assert.equal(await page.evaluate(k => localStorage.getItem(k), key), value);
  await page.goto(`${page.url().split('#')[0]}#/desk`);
  if (answerPending) await answerPending();
  else {
    await page.getByRole('button', {name: /Upgrade fixture: waiting/}).click();
    await page.getByRole('radio', {name: 'Finish migration verification', exact: true}).check();
    await page.getByRole('button', {name: 'Submit answer', exact: true}).click();
  }
  await page.getByText('Authoritative answer saved', {exact: true}).waitFor();
  const result = await api(`${root}/${fixture.tasks.waiting}/result`, {token: fixture.caller});
  assert.equal(result.status, 200); assert.equal(result.data.answers.choice.choice, 'approve');
  return ['caller identity and owner capability preserved', 'old waiting/answered/cancelled/expired/erased tasks preserve authority and original answers', 'original idempotency keys still deduplicate or remain tombstoned', 'provider configuration, route edges and lifecycle commands unchanged', 'old language/theme/scale/status-bar preferences preserved', 'new native decision desk answers the old pending task; original caller retrieves its result'];
}
