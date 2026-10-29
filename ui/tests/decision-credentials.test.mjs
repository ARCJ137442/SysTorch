import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

test('native owner credentials stay bound to the gateway captured before asynchronous IPC', async () => {
  const oldWindow = globalThis.window;
  const oldFetch = globalThis.fetch;
  const oldTauri = globalThis.isTauri;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.isTauri = true;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
  let resolveNative;
  const requests = [];
  globalThis.window = { location: { href: 'http://127.0.0.1:11436/#/desk', origin: 'http://127.0.0.1:11436' }, addEventListener(){}, dispatchEvent() {}, __TAURI_INTERNALS__: { invoke: () => new Promise(resolve => { resolveNative = resolve; }) } };
  globalThis.fetch = async (...args) => { requests.push(args); return { status: 200, ok: true, json: async () => ({}) }; };
  try {
    const api = await loadTs('../src/api/decisions.ts');
    const inFlight = api.decisionRequest('/identity');
    await Promise.resolve();
    assert.equal(typeof resolveNative, 'function');
    window.__JEV_BASE__ = 'https://other-gateway.invalid';
    resolveNative('st_owner_synthetic_fixture_only');
    await assert.rejects(inFlight, error => error.name === 'AbortError');
    assert.equal(requests.length, 0, 'the local capability must never be sent to the new gateway');
    await assert.rejects(api.decisionRequest('/identity'), error => error.code === 'decision_auth_required');
    assert.equal(requests.length, 0, 'a cached local owner capability is not valid for a remote gateway');
  } finally {
    globalThis.window = oldWindow;
    globalThis.fetch = oldFetch;
    globalThis.isTauri = oldTauri;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  }
});

test('a caller change and logout cannot revive a prior browser owner capability', async () => {
  const oldWindow=globalThis.window, oldFetch=globalThis.fetch, oldTauri=globalThis.isTauri;
  globalThis.isTauri=false;
  globalThis.window={location:{href:'http://127.0.0.1:11436/#/desk',origin:'http://127.0.0.1:11436'},addEventListener(){},dispatchEvent(){}};
  const headers=[];
  globalThis.fetch=async (_url,init)=>{headers.push(new Headers(init.headers).get('Authorization'));return {status:200,ok:true,json:async()=>({})};};
  try {
    const api=await loadTs('./fixtures/decision-auth-target.ts');
    api.setDecisionCredential('st_owner_synthetic_owner');
    await api.decisionRequest('/identity');
    api.setCallerSession('jev_synthetic_caller',{id:'caller',role:'readonly'});
    await api.decisionRequest('/identity');
    api.clearCallerSession();
    await assert.rejects(api.decisionRequest('/identity'),e=>e.code==='decision_auth_required');
    assert.deepEqual(headers,['Bearer st_owner_synthetic_owner','Bearer jev_synthetic_caller']);
  } finally {globalThis.window=oldWindow;globalThis.fetch=oldFetch;globalThis.isTauri=oldTauri;}
});
