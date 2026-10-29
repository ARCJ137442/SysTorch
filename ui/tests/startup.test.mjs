import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const { readStartupPage, startupRoute } = await loadTs('../src/settings/startup.ts');
test('startup preference accepts only explicit page semantics and tolerates denied storage', () => {
  assert.equal(readStartupPage({ getItem: () => 'dashboard' }), 'dashboard');
  assert.equal(readStartupPage({ getItem: () => 'last' }), 'last');
  assert.equal(readStartupPage({ getItem: () => 'https://elsewhere.invalid' }), 'start');
  assert.equal(readStartupPage({ getItem: () => { throw Error('denied'); } }), 'start');
  assert.equal(startupRoute(['start', 'desk', 'dashboard']), 'start');
});
