// Loopback-only runtime smoke: fresh config/database, synthetic upstream, owned
// child process. Never reads the user's providers.toml or calls a real model.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const binary = path.resolve(process.argv[2] ?? 'rs/target/debug/systorch-daemon.exe');
const output = path.resolve(process.argv[3] ?? '.tmp/m0-20261024/runtime');
await mkdir(output, { recursive: true });
const report = { date: new Date().toISOString(), scope: 'debug daemon, loopback synthetic HTTP only', binarySha256: createHash('sha256').update(await readFile(binary)).digest('hex'), runs: [], realModelCalls: 0 };
let received = 0;
const upstream = createServer(async (req, res) => {
  if (req.url !== '/v1/systemone') { res.writeHead(404).end(); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  received++;
  assert.equal(body.model, 'sys1-smoke');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ model: body.model, answers: { ready: { type: 'noul', probability: 0.95 } }, usage: { input_tokens: 1, output_tokens: 1 }, upstream_calls: 1 }));
});
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
const reservation = createTcpServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const runDirectory = await mkdtemp(path.join(output, 'run-'));
const configPath = path.join(runDirectory, 'providers.toml');
await writeFile(configPath, `mode = "local"\nbind = "127.0.0.1:${port}"\n[providers.fixture]\nkind = "typesafe"\nbase = "http://127.0.0.1:${upstream.address().port}/v1/systemone"\nenabled = true\nmodels = ["sys1-smoke"]\n[[routes]]\nleft = "m0-entry"\nright = "fixture"\nupstream_model = "sys1-smoke"\npriority = 10\n`);
let child;
let logs = '';
async function request(url, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${base}${url}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(3000) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
async function stopOwnedChild() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill(); await exited; child = undefined;
}
try {
  for (let cycle = 0; cycle < 3; cycle++) {
    const started = performance.now();
    const env = { ...process.env, JEV_SWITCH_CONFIG: configPath, JEV_BIND: `127.0.0.1:${port}`, JEV_SWITCH_MODE: 'local' };
    delete env.JEV_ADMIN_PASSWORD; delete env.JEV_CALL_TOKEN;
    child = spawn(binary, [], { cwd: runDirectory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
    let health;
    while (performance.now() - started < 15000) {
      assert.equal(child.exitCode, null, `isolated daemon exited: ${logs.slice(-2000)}`);
      try { const result = await request('/health'); if (result.status === 200) { health = result.data; break; } } catch { /* Listener is not ready yet. */ }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(health, 'daemon readiness deadline');
    const startupMs = performance.now() - started;
    const routes = (await request('/v1/admin/routes')).data.routes;
    const original = routes.find(route => route.left === 'm0-entry');
    assert.equal(original.priority, 10 + cycle, 'configuration must survive process restart');
    const edited = { ...original, priority: original.priority + 1 };
    const edgeId = JSON.stringify([original.left, original.right, original.match, original.upstream_model]);
    assert.equal((await request('/v1/admin/routes/transaction', { operations: [{ op: 'update', edge_id: edgeId, expected: original, route: edited }] })).status, 200);
    assert.equal((await request('/v1/admin/routes/transaction', { operations: [{ op: 'delete', edge_id: edgeId, expected: original }] })).status, 409);
    assert.equal((await request('/v1/admin/routes', { routes: [] }, 'PUT')).status, 405);
    const durations = [];
    for (let i = 0; i < 20; i++) {
      const at = performance.now();
      const result = await request('/v1/systemone', { model: 'm0-entry', state: { test: 'isolated' }, questions: { ready: { type: 'noul', instructions: 'Is the synthetic fixture available?' } } });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.equal(result.data.answers.ready.probability, 0.95);
      assert.equal(result.data.upstream_calls, 1);
      assert.equal(result.data.route_trace.selected_provider, 'fixture');
      durations.push(performance.now() - at);
    }
    const count = received;
    assert.equal((await request('/v1/systemone', { model: 'unknown', state: {}, questions: {} })).status, 404);
    assert.equal((await request('/v1/systemone', { model: 'm0-entry', state: {}, questions: [] })).status, 400);
    assert.equal(received, count, 'invalid calls must not dispatch upstream');
    const telemetry = (await request('/v1/admin/telemetry')).data;
    durations.sort((a, b) => a - b);
    report.runs.push({ cycle: cycle + 1, kind: cycle ? 'process restart with existing isolated DB' : 'first process start with new isolated DB', startupToHealthMs: startupMs, health, requests: durations.length, p50Ms: durations[9], p95Ms: durations[18], daemonResource: telemetry.daemon, shellResource: telemetry.shell, persistedPriority: edited.priority });
    await stopOwnedChild();
    await assert.rejects(fetch(`${base}/health`, { signal: AbortSignal.timeout(500) }), 'owned process exit must release its listener');
  }
  assert.equal(received, 60);
  report.syntheticUpstreamCalls = received;
  report.status = 'PASS';
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.status = 'FAIL'; report.failure = String(error.stack ?? error); throw error; }
finally {
  await stopOwnedChild(); await new Promise(resolve => upstream.close(resolve));
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, 'daemon.log'), logs);
}
