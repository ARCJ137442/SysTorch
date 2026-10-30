import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const api = await loadTs('../src/api.ts');

test('Start sends the SysTorch request superset with stable question order', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ answers: {}, upstream_calls: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const request = {
      model: 'entry-main',
      state: { context: 'shared' },
      questions: { second: { type: 'noul' }, first: { type: 'choice' } },
    };
    await api.postSysTorchSystemOne({ ...request, question_order: ['second', 'first'] });

    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, '/v1/systorch/systemone');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      ...request,
      question_order: ['second', 'first'],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy Playground API remains the TypeSafe-compatible projection route', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ answers: {}, upstream_calls: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const request = { model: 'entry-main', state: null, questions: { q: { type: 'noul' } } };
    await api.postSystemOne(request);
    assert.equal(new URL(calls[0].url).pathname, '/v1/systemone');
    assert.deepEqual(JSON.parse(calls[0].init.body), request);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SysTorch API errors prefer the stable SysTorch request ID header', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid order', upstream: null, retryable: false, route_trace: { outcome: 'failed', attempts: [{ provider_id: 'first', outcome: 'failed', upstream_status: 429 }] } }), {
    status: 400,
    headers: { 'content-type': 'application/json', 'x-systorch-request-id': 'st-123' },
  });
  try {
    await assert.rejects(
      api.postSysTorchSystemOne({ model: 'entry-main', state: null, questions: {}, question_order: [] }),
      error => error instanceof api.SystemOneError && error.requestId === 'st-123',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
