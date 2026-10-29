import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';

test('duplicate native notifications consume one pending gesture only once', async () => {
  const {createGatewayIntentDrain} = await loadTs('../src/app/gatewayIntentDrain.ts');
  let pending = true, running = false, writes = 0;
  const drain = createGatewayIntentDrain({takePending: async () => {const value = pending; pending = false; return value;}, readStatus: async () => ({running}), setRunning: async value => {writes++; running = value; return {running};}});
  await Promise.all([drain(), drain(), drain()]);
  assert.equal(writes, 1); assert.equal(running, true);
});

test('an in-flight gesture survives navigation and a failure does not poison later gestures', async () => {
  const {createGatewayIntentDrain} = await loadTs('../src/app/gatewayIntentDrain.ts');
  let pending = true, release, writes = 0;
  const drain = createGatewayIntentDrain({takePending: async () => {const value = pending; pending = false; return value;}, readStatus: async () => new Promise(resolve => {release = resolve;}), setRunning: async value => {writes++; if (writes === 1) throw Error('unknown result'); return {running: value};}});
  const first = drain(); await new Promise(resolve => setImmediate(resolve));
  release({running: false}); await assert.rejects(first, /unknown result/);
  pending = true;
  const next = drain(); await new Promise(resolve => setImmediate(resolve));
  release({running: true}); assert.deepEqual(await next, {running: false}); assert.equal(writes, 2);
});
