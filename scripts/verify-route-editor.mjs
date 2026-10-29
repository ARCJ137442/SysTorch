// Browser integration for the production route editor. All HTTP API requests
// are intercepted in a fresh profile; there is no connection to a real daemon.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://127.0.0.1:5173';
assert.equal(new URL(base).hostname, '127.0.0.1');
const output = path.resolve(process.argv[3] ?? '.tmp/m0-20261024/route-editor');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
const page = await context.newPage();
const edge = (left, priority = 10) => ({ left, right: 'provider', match: 'exact', upstream_model: null, priority, sticky: 'none', on_error: 'next' });
let routes = [edge('alpha')];
const writes = [];
const errors = [];
const blockedAssets = [];
let delayNext = false;
let release;
await page.addInitScript(base => { window.__JEV_BASE__ = base; localStorage.setItem('jev_lang', 'en'); }, base);
page.on('pageerror', error => errors.push(error.message));
const identity = route => JSON.stringify([route.left, route.right, route.match, route.upstream_model ?? null]);
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(base).origin) {
    if (url.pathname.startsWith('/v1/')) errors.push(`Unexpected gateway origin: ${url.origin}`);
    blockedAssets.push(url.origin);
    return route.abort();
  }
  if (url.pathname === '/v1/admin/routes/transaction') {
    const body = route.request().postDataJSON(); writes.push(body.operations);
    const next = structuredClone(routes);
    for (const operation of body.operations) {
      const index = next.findIndex(r => identity(r) === operation.edge_id);
      if (operation.op !== 'create' && (index < 0 || !isDeepStrictEqual(next[index], operation.expected))) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'edge changed', upstream: null, retryable: false }) });
      }
      if (operation.op === 'create') next.push(operation.route);
      else if (operation.op === 'update') next[index] = operation.route;
      else next.splice(index, 1);
    }
    if (delayNext) { delayNext = false; await new Promise(resolve => { release = resolve; }); }
    routes = next;
    return route.fulfill({ json: { routes } });
  }
  if (url.pathname === '/v1/admin/routes') return route.fulfill({ json: { routes } });
  if (url.pathname === '/v1/admin/providers') return route.fulfill({ json: { providers: [{ id: 'provider', kind: 'typesafe', base: 'http://127.0.0.1:1/v1/systemone', enabled: true, models: ['fixture'], api_key_masked: '', api_key_set: false }] } });
  if (url.pathname === '/v1/admin/endpoints') return route.fulfill({ json: { endpoints: [{ id: 'alpha', enabled: true, strategy_config: { type: 'failover' }, routes_count: 1, health_summary: { total: 1, healthy: 0, degraded: 0, failed: 0, unknown: 1 }, calls_24h: 0, calls_total: 0, created_at: 1, updated_at: 1 }] } });
  if (url.pathname === '/health') return route.fulfill({ json: { status: 'ok', version: '0.10.3', product: 'jev-switch', api_revision: 1, build_revision: 'M0-browser-fixture' } });
  if (url.pathname === '/v1/admin/status') return route.fulfill({ json: { mode: 'local', bind: '127.0.0.1:11435', bind_explicit: true, env_override_active: false, password_set: false, version: '0.10.3', uptime_s: 1 } });
  if (url.pathname.includes('/stream')) return route.fulfill({ contentType: 'text/event-stream', body: ': simulated stream\n\n' });
  if (url.pathname.startsWith('/v1/')) return route.fulfill({ json: { events: [], active_requests: 0 } });
  return route.continue();
});
const report = { scope: 'production RoutingPage + mocked HTTP only', cases: [], errors, blockedAssets };
async function waitForWrite(count) {
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
  await page.getByRole('spinbutton', { name: 'Row 1: Priority' }).waitFor();
  // Web-first response event, rather than a timer tied to the debounce duration.
  if (writes.length < count) await page.waitForResponse(r => r.url().endsWith('/v1/admin/routes/transaction'));
}
try {
  await page.goto(`${base}/#/routing`);
  await page.getByRole('button', { name: /table/i }).click();
  const priority = page.getByRole('spinbutton', { name: 'Row 1: Priority' });
  await priority.waitFor();
  routes.push(edge('remote-added'));
  const saved = page.waitForResponse(r => r.url().endsWith('/v1/admin/routes/transaction'));
  await priority.fill('20'); await saved;
  await page.getByRole('textbox', { name: 'Row 2: Source' }).waitFor();
  assert.equal(writes[0].length, 1); assert.equal(writes[0][0].op, 'update');
  assert(routes.some(r => r.left === 'remote-added'));
  report.cases.push('stale browser editor preserves remotely added edge and adopts receipt');

  const undone = page.waitForResponse(r => r.url().endsWith('/v1/admin/routes/transaction'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await undone;
  assert(routes.some(r => r.left === 'remote-added'));
  assert.equal(routes.find(r => r.left === 'alpha').priority, 10);
  report.cases.push('undo retains remote edge and submits only its own inverse edit');

  delayNext = true;
  const delayedRequest = page.waitForRequest(r => r.url().endsWith('/v1/admin/routes/transaction'));
  await priority.fill('30'); await delayedRequest;
  const submitted = page.waitForResponse(r => r.url().endsWith('/v1/admin/routes/transaction'));
  await priority.fill('40'); release(); await submitted;
  await waitForWrite(4);
  await page.waitForFunction(() => document.querySelector('input[aria-label="Row 1: Priority"]')?.value === '40');
  assert.equal(routes.find(r => r.left === 'alpha').priority, 40);
  report.cases.push('edits typed while saving are rebased and submitted after acknowledgement');

  routes.find(r => r.left === 'alpha').priority = 99;
  const conflicted = page.waitForResponse(r => r.url().endsWith('/v1/admin/routes/transaction'));
  await priority.fill('50'); await conflicted;
  await page.getByRole('alert').getByText(/changed in another session/).waitFor();
  assert.equal(routes.find(r => r.left === 'alpha').priority, 99);
  await page.getByRole('button', { name: 'Review latest (keep draft backup)' }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="Row 1: Priority"]')?.value === '99');
  await page.getByText('Unapplied draft backup (expand to copy)', { exact: true }).click();
  assert((await page.getByRole('textbox', { name: 'Unapplied draft backup (expand to copy)' }).inputValue()).includes('50'));
  report.cases.push('conflict preserves draft backup and permits safe review of latest graph');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'route-conflict-recovery.png'), fullPage: true });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error.stack ?? error);
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
