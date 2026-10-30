// Isolated, real daemon + browser contract test. No user profile, upstream or key is read.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, cp, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const skipBrowser = process.env.SYSTORCH_SKIP_UI === '1';
const chromium = skipBrowser ? null : require(process.env.SYSTORCH_PLAYWRIGHT_PACKAGE ?? 'playwright').chromium;
const binary = path.resolve(process.argv[2] ?? 'rs/target/debug/systorch-daemon.exe');
const output = path.resolve(process.argv[3] ?? '.tmp/m1-verification');
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(output, 'run-'));
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
let syntheticModelCalls = 0;
let forwardedAssets = null;
const upstream = createHttpServer(async (req, res) => {
  if (req.url !== '/v1/systemone') { res.writeHead(404).end(); return; }
  const chunks=[]; for await (const chunk of req) chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks));
  assert.equal(body.question_order, undefined, 'presentation-only SysTorch order must be consumed before provider dispatch');
  syntheticModelCalls++;
  if (body.assets) forwardedAssets = body.assets;
  const questionId=Object.keys(body.questions)[0];
  const question=body.questions[questionId];
  const answers=question.type==='choice' ? {[questionId]:{type:'choice',choice:'option1',probabilities:{option1:0.9,option2:0.1},confidence:0.9}} : {[questionId]:{type:'noul',probability:0.9}};
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ model: 'm1-synthetic', answers, upstream_calls: 1 }));
});
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
const config = path.join(root, 'providers.toml');
await writeFile(config, `mode="local"\nbind="127.0.0.1:${port}"\n[providers.fixture]\nkind="typesafe"\nbase="http://127.0.0.1:${upstream.address().port}/v1/systemone"\nforward_extensions=true\nenabled=true\nmodels=["m1-synthetic"]\n[[routes]]\nleft="m1-fixture"\nright="fixture"\nupstream_model="m1-synthetic"\npriority=10\n`);
const report = { started: new Date().toISOString(), binarySha256: createHash('sha256').update(await readFile(binary)).digest('hex'), scope: 'isolated daemon, real HTTP/SQLite and Chromium; synthetic Noul/Choice/Score/Box and media only', checks: [], realModelCalls: 0 };
const check = name => { report.checks.push(name); console.log(`PASS ${name}`); };
let child, browser, logs = '';
async function request(url, token, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  if (url.startsWith('/v1/systorch/') || url === '/v1/systemone') assert.equal(response.headers.get('cache-control'),'no-store');
  return { status: response.status, data };
}
async function uploadSyntheticAsset(token, bytes, mimeType) {
  const response = await fetch(`${base}/v1/systorch/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType },
    body: bytes,
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 201);
  return { ...(await response.json()), bytes };
}
const uploadSyntheticImage = token => uploadSyntheticAsset(token, syntheticPng(300, 300), 'image/png');
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const label = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, checksum]);
}
function syntheticPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1); raw[row] = 0;
    for (let x = 0; x < width; x++) raw.set([64, 128, 192, 255], row + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
async function start(configPath = config) {
  const env = { ...process.env, JEV_SWITCH_CONFIG: configPath, JEV_SWITCH_DATA_DIR: path.dirname(configPath), JEV_BIND: `127.0.0.1:${port}`, JEV_SWITCH_MODE: 'local', JEV_UI_DIST: path.resolve('ui/dist') };
  delete env.JEV_AUTH_TOKENS; delete env.JEV_ADMIN_PASSWORD;
  child = spawn(binary, [], { cwd: path.dirname(configPath), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    assert.equal(child.exitCode, null, 'isolated daemon exited');
    try { if ((await request('/health')).status === 200) return; } catch { /* bind not ready */ }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('isolated daemon readiness timeout');
}
async function stop() { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } child = null; }
const body = key => ({ entry: 'human:owner', idempotency_key: key, question: 'Should the fixture take a break?', context: { safe: 'SYNTHETIC_PRIVATE_CONTEXT' }, choices: [{ id: 'a', label: 'Take a break' }, { id: 'b', label: 'Continue' }], ttl_seconds: 3600 });
const answer = (choice = 'a', revision = 1) => ({ revision, observation: { kind: 'answered', choice_id: choice } });
const route = id => `/v1/systorch/decisions/${id}`;
try {
  await start();
  const rawKey = await readFile(path.join(root, 'systorch-owner.key'));
  const owner = `st_owner_${rawKey.subarray(32).toString('hex')}`;
  const caller = (await request('/v1/admin/tokens', undefined, { name: 'M1 synthetic caller', role: 'readonly' })).data.secret;
  const other = (await request('/v1/admin/tokens', undefined, { name: 'M1 synthetic admin', role: 'admin' })).data.secret;
  assert.equal(typeof caller, 'string'); assert.equal(typeof other, 'string');
  assert.equal((await request('/v1/systorch/decisions')).status, 401);
  assert.equal((await request('/v1/systorch/identity', caller)).data.can_answer, false);
  assert.equal((await request('/v1/systorch/identity', owner)).data.can_answer, true);
  check('explicit identity required even on local loopback');
  const submitted = await request('/v1/systorch/decisions', caller, body('durable'));
  assert.equal(submitted.status, 202); const task = submitted.data;
  assert.equal((await request(`${route(task.id)}/result`, caller)).status, 202);
  assert.equal((await request(route(task.id), other)).status, 404);
  assert.equal((await request(`${route(task.id)}/answers`, other, answer())).status, 403);
  assert.equal((await request(`${route(task.id)}/cancel`, other, {})).status, 404);
  check('caller task isolation and admin role does not imply answer permission');
  const independentA=(await request('/v1/systorch/decisions',caller,body('two-callers-same-key'))).data;
  const independentB=(await request('/v1/systorch/decisions',other,{...body('two-callers-same-key'),question:'Another caller question'})).data;
  assert.notEqual(independentA.id,independentB.id);
  await Promise.all([request(`${route(independentB.id)}/answers`,owner,answer('b')),request(`${route(independentA.id)}/answers`,owner,answer('a'))]);
  assert.equal((await request(`${route(independentA.id)}/result`,caller)).data.answers.choice.choice,'a');
  assert.equal((await request(`${route(independentB.id)}/result`,other)).data.answers.choice.choice,'b');
  assert.equal((await request(route(independentB.id),caller)).status,404);
  check('interleaved requests from two callers retain separate ownership and answers');
  const immediate = await request('/v1/systemone', undefined, { model: 'm1-fixture', state: {}, questions: { ready: { type: 'noul', instructions: 'Is the synthetic fixture ready?' } } });
  assert.equal(immediate.status, 200); assert.equal(immediate.data.answers.ready.probability, 0.9);
  assert.equal(immediate.data.route_trace.selected_provider, 'fixture');
  const canonicalImmediate = await request('/v1/systorch/systemone', undefined, {
    model: 'm1-fixture', state: {},
    questions: { ready: { type: 'noul', instructions: 'Is the synthetic fixture ready?' } },
    question_order: ['ready'],
  });
  assert.equal(canonicalImmediate.status, 200, JSON.stringify(canonicalImmediate.data));
  assert.equal(canonicalImmediate.data.answers.ready.probability, 0.9);
  const dispatchedBeforeInvalidOrder = syntheticModelCalls;
  const invalidOrder = await request('/v1/systorch/systemone', caller, {
    model: 'm1-fixture', state: {},
    questions: { ready: { type: 'noul', instructions: 'Is the synthetic fixture ready?' } },
    question_order: ['unknown-question'],
  });
  assert.equal(invalidOrder.status, 400);
  assert.equal(syntheticModelCalls, dispatchedBeforeInvalidOrder, 'invalid order must be rejected before provider dispatch');
  assert.equal((await request(route(task.id), caller)).data.status, 'pending');
  check('legacy Jev and canonical SysTorch request paths share DAG routing; question order is consumed before TypeSafe-compatible upstream dispatch');

  const chatImage = await uploadSyntheticImage(caller);
  const chatAudio = await uploadSyntheticAsset(caller, Buffer.from('RIFFsynthetic-wav'), 'audio/wav');
  const chatVideo = await uploadSyntheticAsset(caller, Buffer.from('synthetic-mp4-ftypisom'), 'video/mp4');
  const chatFile = await uploadSyntheticAsset(caller, Buffer.from('%PDF-1.4 synthetic attachment'), 'application/pdf');
  const chatUploads = { 'chat-image': chatImage, 'chat-audio': chatAudio, 'chat-video': chatVideo, 'chat-file': chatFile };
  const chatAssetDescriptors = {
    'chat-image': { type: 'image', format: 'png', mime_type: 'image/png', filename: 'chat-synthetic.png', asset_id: chatImage.asset_id },
    'chat-audio': { type: 'audio', format: 'wav', mime_type: 'audio/wav', filename: 'chat-synthetic.wav', asset_id: chatAudio.asset_id },
    'chat-video': { type: 'video', format: 'mp4', mime_type: 'video/mp4', filename: 'chat-synthetic.mp4', asset_id: chatVideo.asset_id },
    'chat-file': { type: 'file', format: 'pdf', mime_type: 'application/pdf', filename: 'chat-synthetic.pdf', asset_id: chatFile.asset_id },
  };
  const chatId = 'start_m1_synthetic_chat_001';
  const chatRequest = {
    model: 'm1-fixture',
    state: { note: 'CHAT_PRIVATE_SENTINEL', _systorch: { assets: Object.keys(chatAssetDescriptors) } },
    questions: { ready: { type: 'noul', instructions: 'Should the synthetic chat be retained?' } },
    assets: chatAssetDescriptors,
  };
  const chatStart = await request(`/v1/systorch/sessions/${chatId}/messages`, caller, {
    expected_revision: 0,
    message: { kind: 'request', id: 'chat-request-1', created_at: Math.floor(Date.now() / 1000), request: chatRequest, question_order: ['ready'] },
  });
  assert.equal(chatStart.status, 201);
  assert.equal(chatStart.data.summary.title, 'Should the synthetic chat be retained?');
  assert.equal(chatStart.data.summary.interrupted, true);
  const chatSysTorchRequest = { ...chatRequest, question_order: ['ready'] };
  const chatModelResponse = await request('/v1/systorch/systemone', caller, chatSysTorchRequest);
  assert.equal(chatModelResponse.status, 200, JSON.stringify(chatModelResponse.data));
  assert.equal(chatModelResponse.data.answers.ready.probability, 0.9);
  for (const [reference, uploaded] of Object.entries(chatUploads)) {
    const projected = forwardedAssets?.[reference];
    assert(projected, `provider receives the ${reference} descriptor without frontend capability filtering`);
    assert.equal(projected.asset_id, undefined, 'SysTorch-local asset identifiers never leave the gateway');
    assert.deepEqual(Buffer.from(projected.data_base64, 'base64'), uploaded.bytes, `${reference} bytes survive the TypeSafe-compatible projection`);
    assert.equal(projected.type, chatAssetDescriptors[reference].type);
    if (reference !== 'chat-image') assert.equal(projected.mime_type, chatAssetDescriptors[reference].mime_type);
  }
  check('encrypted asset registry accepts image, audio, video and file; a compatible TypeSafe endpoint receives exact bytes, the standard image projection and full non-image descriptors without local asset IDs');
  const chatCompleted = await request(`/v1/systorch/sessions/${chatId}/messages`, caller, {
    expected_revision: 1,
    message: { kind: 'response', id: 'chat-reply-1', created_at: Math.floor(Date.now() / 1000), reply_to: 'chat-request-1', response: chatModelResponse.data },
  });
  assert.equal(chatCompleted.status, 200);
  assert.equal(chatCompleted.data.summary.revision, 2);
  assert.equal(chatCompleted.data.summary.has_unread_reply, true);
  assert.equal(chatCompleted.data.summary.interrupted, false);
  assert.equal((await request(`/v1/systorch/sessions/${chatId}`, other)).status, 404);
  assert.equal((await request(`/v1/systorch/sessions/${chatId}/messages`, caller, { expected_revision: 1, message: { kind: 'request', id: 'chat-request-2', created_at: 120, request: chatRequest, question_order: ['ready'] } })).status, 409);
  for (const uploaded of Object.values(chatUploads)) {
    const chatAsset = await fetch(`${base}/v1/systorch/sessions/${chatId}/assets/${uploaded.asset_id}`, { headers: { Authorization: `Bearer ${caller}` } });
    assert.equal(chatAsset.status, 200);
    assert.deepEqual(Buffer.from(await chatAsset.arrayBuffer()), uploaded.bytes);
  }
  assert(chatCompleted.data.messages.length === 2);
  assert.equal((await request(`/v1/systorch/sessions/${chatId}?archived=false`, caller)).status, 200);
  const markedChat = await request(`/v1/systorch/sessions/${chatId}`, caller, { expected_revision: 2, pinned: true }, 'PATCH');
  assert.equal(markedChat.status, 200);
  assert.equal(markedChat.data.summary.pinned, true);
  const archivedChat = await request(`/v1/systorch/sessions/${chatId}`, caller, { expected_revision: 3, archived: true }, 'PATCH');
  assert.equal(archivedChat.status, 200);
  assert.equal(archivedChat.data.summary.archived, true);
  const secondUserMessage = await request(`/v1/systorch/sessions/${chatId}/messages`, caller, {
    expected_revision: 4,
    message: { kind: 'request', id: 'chat-request-2', created_at: Math.floor(Date.now() / 1000), request: chatRequest, question_order: ['ready'] },
  });
  assert.equal(secondUserMessage.status, 200);
  assert.equal(secondUserMessage.data.summary.archived, false, 'new activity returns an archived chat to recent chats');
  const secondModelResponse = await request('/v1/systorch/systemone', caller, chatSysTorchRequest);
  const secondReply = await request(`/v1/systorch/sessions/${chatId}/messages`, caller, {
    expected_revision: 5,
    message: { kind: 'response', id: 'chat-reply-2', created_at: Math.floor(Date.now() / 1000), reply_to: 'chat-request-2', response: secondModelResponse.data },
  });
  assert.equal(secondReply.status, 200);
  assert.equal(secondReply.data.messages.length, 4);
  assert.equal(secondReply.data.summary.has_unread_reply, true);
  const readAfterReply = await request(`/v1/systorch/sessions/${chatId}`, caller, { expected_revision: 6, mark_read: true }, 'PATCH');
  assert.equal(readAfterReply.status, 200);
  assert.equal(readAfterReply.data.summary.has_unread_reply, false);
  check('ordinary model chat stores encrypted request/response messages, stable question order, caller isolation, CAS conflict and scoped media');

  const repeated = await Promise.all(Array.from({ length: 20 }, () => request('/v1/systorch/decisions', caller, body('durable'))));
  assert(repeated.every(r => r.status === 200 && r.data.id === task.id));
  assert.equal((await request('/v1/systorch/decisions', caller, { ...body('durable'), question: 'Changed' })).status, 409);
  check('20 duplicate submissions are the same durable task; changed body conflicts');
  await stop(); await start();
  assert.equal((await request(route(task.id), caller)).data.status, 'pending');
  const recoveredChat = await request(`/v1/systorch/sessions/${chatId}`, caller);
  assert.equal(recoveredChat.status, 200);
  assert.equal(recoveredChat.data.messages.length, 4);
  assert.equal(recoveredChat.data.summary.has_unread_reply, false);
  check('ordinary chat messages and read state survive an actual process exit and restart');
  check('pending survives actual process exit and restart with stable caller/owner');
  const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => request(`${route(task.id)}/answers`, owner, answer(i % 2 ? 'a' : 'b'))));
  const accepted = answers.find(r => r.status === 200).data.observation.choice_id;
  assert(answers.every(r => r.status === (r.data.observation?.choice_id === accepted ? 200 : 409)));
  const result = await request(`${route(task.id)}/result`, caller);
  assert.equal(result.status, 200); assert.equal(result.data.answers.choice.choice, accepted);
  assert.equal(result.data.answers.choice.probabilities[accepted], 1); assert.equal(result.data.upstream_calls, 0);
  assert.equal(Object.keys(result.data.answers.choice.probabilities).length, 2);
  check('20 concurrent conflicting answers select exactly one authoritative observation and strict result');

  const boxImage = await uploadSyntheticImage(caller);
  const typedBody = {
    model: 'human:owner', state: { fixture: 'canonical SysTorch synthetic request' }, entry: 'human:owner',
    idempotency_key: 'typed-primitives', ttl_seconds: 3600,
    question_order: ['route', 'ready', 'severity', 'region'],
    questions: {
      route: { type: 'choice', instructions: 'Which route should be used?', criteria: { local: 'Use local', cloud: 'Use cloud' } },
      ready: { type: 'noul', instructions: 'Is the local option ready?', criteria: { true: 'Ready', false: 'Not ready' } },
      severity: { type: 'score', instructions: 'How severe is the issue?', criteria: ['Cosmetic', 'Workaround exists', 'Blocking'] },
      region: { type: 'box', instructions: { text: 'Mark the relevant region.', _systorch: { assets: ['box_image'] } } },
    },
    assets: { box_image: { type: 'image', format: 'png', mime_type: 'image/png', filename: 'synthetic.png', asset_id: boxImage.asset_id } },
  };
  const typedTaskResponse = await request('/v1/systorch/decisions', caller, typedBody);
  assert.equal(typedTaskResponse.status, 202);
  const typedTask = typedTaskResponse.data;
  assert.equal(typedTask.request.model, 'human:owner');
  assert.deepEqual(typedTask.request.state, typedBody.state);
  assert.equal(typedTask.request.questions.severity.type, 'score');
  const unauthorizedAsset = await fetch(`${base}${route(typedTask.id)}/assets/${boxImage.asset_id}`, { headers: { Authorization: `Bearer ${other}` } });
  assert.equal(unauthorizedAsset.status, 404, 'a different caller cannot read another task image');
  const authorizedAsset = await fetch(`${base}${route(typedTask.id)}/assets/${boxImage.asset_id}`, { headers: { Authorization: `Bearer ${caller}` } });
  assert.equal(authorizedAsset.status, 200);
  assert.deepEqual(Buffer.from(await authorizedAsset.arrayBuffer()), boxImage.bytes);
  const invalidTypedAnswer = await request(`${route(typedTask.id)}/answers`, owner, {
    revision: 1,
    observations: {
      route: { kind: 'answered', choice_id: 'cloud' },
      ready: { kind: 'score', level_index: 1 },
      severity: { kind: 'score', level_index: 2 },
      region: { kind: 'box', top: 0.1, bottom: 0.8, left: 0.2, right: 0.9 },
    },
  });
  assert.equal(invalidTypedAnswer.status, 422);
  assert.equal((await request(route(typedTask.id), caller)).data.status, 'pending');
  const invalidScore = await request(`${route(typedTask.id)}/answers`, owner, {
    revision: 1,
    observations: {
      route: { kind: 'answered', choice_id: 'cloud' },
      ready: { kind: 'noul', value: true },
      severity: { kind: 'score', level_index: 9 },
      region: { kind: 'box', top: 0.1, bottom: 0.8, left: 0.2, right: 0.9 },
    },
  });
  assert.equal(invalidScore.status, 400);
  assert.equal((await request(route(typedTask.id), caller)).data.status, 'pending', 'invalid score level must roll back the whole answer batch');
  const typedAnswer = await request(`${route(typedTask.id)}/answers`, owner, {
    revision: 1,
    observations: {
      route: { kind: 'answered', choice_id: 'cloud' },
      ready: { kind: 'noul', value: true, note: 'Synthetic note' },
      severity: { kind: 'score', level_index: 2 },
      region: { kind: 'box', top: 0.1, bottom: 0.8, left: 0.2, right: 0.9 },
    },
  });
  assert.equal(typedAnswer.status, 200);
  const typedResult = await request(`${route(typedTask.id)}/result`, caller);
  assert.equal(typedResult.status, 200);
  assert.equal(typedResult.data.model, 'human:owner');
  assert.equal(typedResult.data.answers.route.choice, 'cloud');
  assert.equal(typedResult.data.answers.ready.noul, 1);
  assert.equal(typedResult.data.answers.severity.score, 2);
  assert.equal(typedResult.data.answers.severity.confidence, 1);
  assert.deepEqual(typedResult.data.answers.region.box, { top: 0.1, bottom: 0.8, left: 0.2, right: 0.9 });
  assert.equal(typedResult.data.upstream_calls, 0);
  check('canonical model/state/questions envelope persists all four answer types, rejects type mismatch atomically, and scopes Box assets to the task owner');

  await stop(); await start();
  assert.deepEqual((await request(`${route(task.id)}/result`, caller)).data, result.data);
  assert.deepEqual((await request(`${route(typedTask.id)}/result`, caller)).data, typedResult.data);
  check('completed Choice and multi-type results survive a second real restart without executing any upstream');
  assert.equal((await request(`/v1/systorch/sessions/${chatId}`, caller, undefined, 'DELETE')).status, 204);
  assert.equal((await request(`/v1/systorch/sessions/${chatId}`, caller)).status, 404);
  for (const uploaded of Object.values(chatUploads)) {
    assert.equal((await fetch(`${base}/v1/systorch/sessions/${chatId}/assets/${uploaded.asset_id}`, { headers: { Authorization: `Bearer ${caller}` } })).status, 404);
    assert.equal((await request(`/v1/systorch/assets/${uploaded.asset_id}`, caller, undefined, 'GET')).status, 404);
  }
  check('deleting a chat erases its encrypted content and unshared linked media');
  const revised = (await request('/v1/systorch/decisions', caller, body('revise'))).data;
  assert.equal((await request(`${route(revised.id)}/clarifications`, owner, { revision: 1, question: 'What is the workload?' })).status, 200);
  assert.equal((await request(`${route(revised.id)}/revisions`, owner, { revision: 1, question: 'Unauthorized rewrite', context: {}, choices: body('').choices })).status, 403);
  assert.equal((await request(`${route(revised.id)}/revisions`, caller, { revision: 1, question: 'Updated workload', context: {}, choices: body('').choices })).data.revision, 2);
  assert.equal((await request(`${route(revised.id)}/answers`, owner, answer())).status, 409);
  assert.equal((await request(`${route(revised.id)}/answers`, owner, { revision: 2, observation: { kind: 'conditional', choice_id: 'a', condition: 'After saving the fixture' } })).status, 200);
  assert.equal((await request(`${route(revised.id)}/result`, caller)).data.code, 'conditional_not_projectable');
  check('caller-only revision, responder clarification, stale answer rejection and conditional projection stop');
  const declined = (await request('/v1/systorch/decisions', caller, body('decline'))).data;
  await request(`${route(declined.id)}/answers`, owner, { revision: 1, observation: { kind: 'declined', reason: 'Insufficient evidence' } });
  assert.equal((await request(`${route(declined.id)}/result`, caller)).data.code, 'decision_declined');
  const cancelled = (await request('/v1/systorch/decisions', caller, body('cancel'))).data;
  assert.equal((await request(route(cancelled.id), caller, undefined, 'DELETE')).status, 409);
  await request(`${route(cancelled.id)}/cancel`, caller, {});
  assert.equal((await request(`${route(cancelled.id)}/answers`, owner, answer())).status, 409);
  assert.equal((await request(route(cancelled.id), caller, undefined, 'DELETE')).status, 204);
  assert.equal((await request('/v1/systorch/decisions', caller, body('cancel'))).status, 410);
  check('refusal, cancellation, erasure and persistent no-replay tombstones');
  const expired = (await request('/v1/systorch/decisions', caller, { ...body('expire'), ttl_seconds: 1 })).data;
  while (Date.now() / 1000 < expired.deadline) await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await request(`${route(expired.id)}/answers`, owner, answer())).status, 409);
  assert.equal((await request(route(expired.id), caller)).data.status, 'expired');
  check('wall-clock expiry is enforced before any late answer');

  if (chromium) {
  browser = await chromium.launch({ headless: true, ...(process.env.SYSTORCH_CHROMIUM_EXECUTABLE ? { executablePath: process.env.SYSTORCH_CHROMIUM_EXECUTABLE } : {}) });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 800 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage(); const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('jev_lang', 'en'));
    await page.goto(`${base}/#/start`);
    await page.getByLabel('Caller / owner token').fill(owner); await page.getByRole('button', { name: 'Use token', exact: true }).click();
    await page.getByLabel('Caller / owner token').waitFor({ state: 'detached' });
    await page.getByLabel('Question', { exact: true }).waitFor();
    await page.getByLabel('Question', { exact: true }).fill(`Browser ${viewport.width} choice`);
    await page.getByLabel('Alternatives · one per line').fill('Review the fixture\nContinue testing');
    await page.locator('.decision-shared-context > summary').click();
    await page.getByLabel('Context · JSON or plain text').fill('{"safe":"browser fixture"}');
    const acceptedResponse = page.waitForResponse(r => r.url().endsWith('/v1/systorch/decisions') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit decision', exact: true }).click();
    const acceptedTaskResponse = await acceptedResponse;
    assert.equal(acceptedTaskResponse.status(), 202);
    const acceptedTask = await acceptedTaskResponse.json();
    const receipt = acceptedTask.id;
    const questionId = acceptedTask.request.question_order[0];
    await page.getByText('Saved and waiting for an answer in the decision desk.', { exact: true }).waitFor();
    const pendingLayout = await page.getByRole('link', { name: 'Open in decision desk', exact: true }).evaluate(link => {
      const rect = link.getBoundingClientRect();
      const composer = document.querySelector('.decision-chat-composer').getBoundingClientRect();
      const thread = document.querySelector('.decision-chat-thread').getBoundingClientRect();
      return { link: { top: rect.top, bottom: rect.bottom }, composer: { top: composer.top, bottom: composer.bottom }, thread: { top: thread.top, bottom: thread.bottom, scrollHeight: document.querySelector('.decision-chat-thread').scrollHeight, scrollTop: document.querySelector('.decision-chat-thread').scrollTop }, viewport: { width: innerWidth, height: innerHeight } };
    });
    console.log(`pending layout ${viewport.width}: ${JSON.stringify(pendingLayout)}`);
    assert(pendingLayout.link.bottom <= pendingLayout.composer.top, 'the newest pending action remains visible above the composer at every supported viewport');
    await page.screenshot({ path: path.join(output, `start-pending-${viewport.width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Open in decision desk', exact: true }).first().click();
    await page.getByRole('radio', { name: 'Review the fixture', exact: true }).check();
    // Navigation must not submit and must preserve the answer draft.
    await page.getByRole('link', { name: 'Start', exact: true }).click();
    await page.evaluate(taskId => { window.location.hash = `#/desk?task=${encodeURIComponent(taskId)}`; }, receipt);
    await page.getByRole('radio', { name: 'Review the fixture', exact: true }).waitFor();
    assert(await page.getByRole('radio', { name: 'Review the fixture', exact: true }).isChecked());
    assert.equal((await request(route(receipt), owner)).data.status, 'pending');
    await page.getByLabel('Note / reason / condition', { exact: true }).fill('Synthetic explanatory note');
    if (viewport.width===1440) {
      await page.getByLabel('Note / reason / condition',{exact:true}).dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});
      assert.equal((await request(route(receipt),owner)).data.status,'pending','IME confirmation cannot submit an answer');
      await context.setOffline(true);
      await page.getByRole('button',{name:'Submit answer',exact:true}).click();
      await page.getByRole('alert').first().waitFor();
      assert.equal(await page.getByText('Authoritative answer saved',{exact:true}).count(),0);
      assert(await page.getByRole('radio',{name:'Review the fixture',exact:true}).isChecked());
      assert.equal((await request(route(receipt),owner)).data.status,'pending');
      await context.setOffline(false);
      check('IME and offline submission preserve the draft without reporting an authoritative answer');
    }
    await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
    await page.getByRole('heading', { name: 'Authoritative answer saved', exact: true }).waitFor();
    assert.equal((await request(`${route(receipt)}/result`, owner)).data.answers[questionId].choice, 'option1');
    assert.equal((await request(route(receipt), owner)).data.observations[questionId].note, 'Synthetic explanatory note');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    await page.evaluate(() => { const main = document.querySelector('.app-shell__main'); if (main) main.scrollTop = 0; });
    await page.screenshot({ path: path.join(output, `desk-${viewport.width}.png`), fullPage: true });
    await page.reload(); await page.getByLabel('Caller / owner token').fill(owner); await page.getByRole('button', { name: 'Use token', exact: true }).click();
    await page.getByRole('heading', { name: 'Authoritative answer saved', exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
    for (const theme of ['light','dark','system']) for (const scale of [0.1, 1, 1.37, 2]) {
      await page.evaluate(value => { document.documentElement.dataset.theme=value==='system' ? (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light') : value; }, theme);
      await page.evaluate(value => { document.documentElement.style.zoom=String(value); }, scale);
      await page.waitForFunction(() => {
        const shell=document.querySelector('.app-shell');
        return shell.classList.contains('app-shell--compact')===(shell.clientWidth<1280)
          && shell.classList.contains('app-shell--tiny')===(shell.clientWidth<360);
      });
      const geometry=await page.evaluate(() => {
        const links=[...document.querySelectorAll('nav[aria-label=primary] a')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
        return {links,width:innerWidth,height:innerHeight,main:document.querySelector('.app-shell__main').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth+1};
      });
      assert.equal(geometry.overflow,false,`horizontal overflow ${viewport.width} @${scale}`);
      assert(geometry.main>20,`main content remains reachable ${viewport.width} @${scale}`);
      assert(geometry.links.every(r=>r.x>=-1&&r.right<=geometry.width+1&&r.y>=0&&r.bottom<=geometry.height),`all navigation links reachable ${viewport.width} @${scale}`);
      if (theme==='dark' && scale===1) await page.screenshot({path:path.join(output,`desk-${viewport.width}-dark.png`)});
    }
    await context.close();
    check(`real UI submit → navigate draft → answer → caller result → refresh recovery at ${viewport.width}px`);
  }
  const callerContext = await browser.newContext({ viewport: {width:1024,height:800} });
  const callerPage = await callerContext.newPage();
  await callerPage.addInitScript(() => localStorage.setItem('jev_lang','en'));
  await callerPage.goto(`${base}/#/start`);
  await callerPage.getByLabel('Caller / owner token').fill(caller);
  await callerPage.getByRole('button',{name:'Use token',exact:true}).click();
  await callerPage.getByLabel('Caller / owner token').waitFor({state:'detached'});
  await callerPage.getByLabel('Question',{exact:true}).waitFor();
  assert.equal(await callerPage.getByRole('link',{name:'Providers',exact:true}).count(),0);
  await callerPage.getByLabel('Question',{exact:true}).fill('Caller browser fixture');
  await callerPage.getByLabel('Alternatives · one per line').fill('Review from caller\nContinue');
  await callerPage.getByRole('button',{name:'Submit decision',exact:true}).click();
  await callerPage.getByText('Saved and waiting for an answer in the decision desk.',{exact:true}).waitFor();
  await callerPage.getByRole('link',{name:'Open in decision desk',exact:true}).first().click();
  await callerPage.getByText('Caller browser fixture',{exact:true}).first().waitFor();
  assert.equal(await callerPage.getByRole('button',{name:'Submit answer',exact:true}).count(),0);
  await callerPage.getByRole('link',{name:'Start',exact:true}).click();
  await callerPage.locator('.decision-chat-options > details > summary').click();
  await callerPage.getByLabel('Current entry').selectOption('model:m1-fixture');
  await callerPage.getByLabel('Question',{exact:true}).fill('Caller model fixture');
  await callerPage.getByLabel('Alternatives · one per line').fill('Keep the local result\nContinue testing');
  const modelRequest = callerPage.waitForRequest(r=>r.url().endsWith('/v1/systorch/systemone') && r.method()==='POST');
  await callerPage.getByRole('button',{name:'Submit decision',exact:true}).click();
  const emittedModelRequest = await modelRequest;
  assert.equal(emittedModelRequest.headers().authorization,`Bearer ${caller}`);
  assert.equal(emittedModelRequest.postDataJSON().model,'m1-fixture');
  assert.deepEqual(emittedModelRequest.postDataJSON().question_order, Object.keys(emittedModelRequest.postDataJSON().questions));
  await callerPage.getByRole('heading',{name:'Caller model fixture',exact:true}).waitFor();
  await callerContext.close();
  check('browser caller identity is reused by Choice/model APIs; readonly UI hides provider management and Choice denies unassigned answers');

  const chatContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const chatPage = await chatContext.newPage();
  await chatPage.addInitScript(() => localStorage.setItem('jev_lang', 'en'));
  await chatPage.goto(`${base}/#/start`);
  await chatPage.getByLabel('Caller / owner token').fill(owner);
  await chatPage.getByRole('button', { name: 'Use token', exact: true }).click();
  await chatPage.getByLabel('Caller / owner token').waitFor({ state: 'detached' });
  await chatPage.locator('.decision-chat-options > details > summary').click();
  await chatPage.getByLabel('Current entry').selectOption('model:m1-fixture');
  await chatPage.getByLabel('Question', { exact: true }).fill('Should this local chat survive a restart?');
  await chatPage.getByLabel('Alternatives · one per line').fill('Keep the local chat\nContinue testing');
  const firstSessionWrite = chatPage.waitForResponse(r => /\/v1\/systorch\/sessions\/start_[^/]+\/messages$/.test(r.url()) && r.request().method() === 'POST');
  const firstModelRequest = chatPage.waitForRequest(r => r.url().endsWith('/v1/systorch/systemone') && r.method() === 'POST');
  await chatPage.getByRole('button', { name: 'Submit decision', exact: true }).click();
  const firstWrite = await firstSessionWrite;
  assert.equal(firstWrite.status(), 201);
  const sessionId = new URL(firstWrite.url()).pathname.split('/')[4];
  assert.equal((await firstWrite.json()).summary.title, 'Should this local chat survive a restart?');
  const firstModelCall = await firstModelRequest;
  assert.equal(firstModelCall.postDataJSON().model, 'm1-fixture');
  assert.deepEqual(firstModelCall.postDataJSON().question_order, Object.keys(firstModelCall.postDataJSON().questions));
  await chatPage.getByRole('heading', { name: 'Should this local chat survive a restart?', exact: true }).waitFor();
  assert.equal(await chatPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);

  await chatPage.getByLabel('Question', { exact: true }).fill('Can the same chat hold a follow-up?');
  await chatPage.getByLabel('Alternatives · one per line').fill('Yes, keep the thread\nNo, start over');
  const secondSessionWrite = chatPage.waitForResponse(r => r.url().endsWith(`/v1/systorch/sessions/${sessionId}/messages`) && r.request().method() === 'POST');
  await chatPage.getByRole('button', { name: 'Submit decision', exact: true }).click();
  const secondWrite = await secondSessionWrite;
  assert.equal(secondWrite.status(), 200);
  assert.equal((await secondWrite.json()).summary.message_count, 3);
  await chatPage.getByRole('heading', { name: 'Can the same chat hold a follow-up?', exact: true }).waitFor();
  const desktopReplyLayout = await chatPage.evaluate(() => {
    const replies = [...document.querySelectorAll('.decision-response-message')];
    const reply = replies.at(-1)?.getBoundingClientRect();
    const composer = document.querySelector('.decision-chat-composer').getBoundingClientRect();
    const thread = document.querySelector('.decision-chat-thread').getBoundingClientRect();
    return { replyTop: reply?.top ?? -1, replyBottom: reply?.bottom ?? -1, composerTop: composer.top, threadTop: thread.top, threadBottom: thread.bottom };
  });
  assert(desktopReplyLayout.replyTop >= desktopReplyLayout.threadTop - 1 && desktopReplyLayout.replyBottom <= desktopReplyLayout.composerTop + 1, `latest reply stays visible above the desktop composer: ${JSON.stringify(desktopReplyLayout)}`);
  const chatList = (await request('/v1/systorch/sessions?offset=0&archived=false', owner)).data;
  assert.equal(chatList.filter(session => session.id === sessionId).length, 1);
  assert.equal(chatList.find(session => session.id === sessionId).message_count, 4);

  const chatSummary = chatList.find(session => session.id === sessionId);
  const archivedChat = await request(`/v1/systorch/sessions/${sessionId}`, owner, { expected_revision: chatSummary.revision, archived: true }, 'PATCH');
  assert.equal(archivedChat.status, 200); assert.equal(archivedChat.data.summary.archived, true);
  await chatPage.goto(`${base}/#/settings`);
  await chatPage.getByRole('heading', { name: 'Archived chats', exact: true }).waitFor();
  await chatPage.getByText('Should this local chat survive a restart?', { exact: true }).waitFor();
  await chatPage.getByRole('button', { name: 'Restore', exact: true }).click();
  await chatPage.getByText('Should this local chat survive a restart?', { exact: true }).waitFor({ state: 'detached' });
  assert.equal((await request('/v1/systorch/sessions?offset=0&archived=false', owner)).data.find(session => session.id === sessionId).archived, false);
  check('Archived chat appears in Settings and restore returns it to the Start history');

  await chatPage.goto(`${base}/#/start`);
  await chatPage.reload();
  await chatPage.getByLabel('Caller / owner token').fill(owner);
  await chatPage.getByRole('button', { name: 'Use token', exact: true }).click();
  await chatPage.getByRole('heading', { name: 'Can the same chat hold a follow-up?', exact: true }).waitFor({ timeout: 5000 }).catch(async () => {
    await chatPage.getByRole('button', { name: /Should this local chat survive a restart\?/ }).first().click();
    await chatPage.getByRole('heading', { name: 'Can the same chat hold a follow-up?', exact: true }).waitFor();
  });
  assert.equal(await chatPage.getByRole('heading', { name: 'Should this local chat survive a restart?', exact: true }).count(), 1);
  assert.equal(await chatPage.getByRole('heading', { name: 'Can the same chat hold a follow-up?', exact: true }).count(), 1);
  const reloadedChats = (await request('/v1/systorch/sessions?offset=0&archived=false', owner)).data;
  assert.equal(reloadedChats.filter(session => session.id === sessionId).length, 1);
  await chatContext.close();
  check('Start UI creates a persistent model chat, appends a follow-up to the same session, restores both turns, and has no desktop horizontal overflow');

  const mobileChatContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobileChatPage = await mobileChatContext.newPage();
  await mobileChatPage.addInitScript(() => localStorage.setItem('jev_lang', 'en'));
  await mobileChatPage.goto(`${base}/#/start`);
  await mobileChatPage.getByLabel('Caller / owner token').fill(owner);
  await mobileChatPage.getByRole('button', { name: 'Use token', exact: true }).click();
  await mobileChatPage.getByLabel('Caller / owner token').waitFor({ state: 'detached' });
  await mobileChatPage.locator('.decision-chat-options > details > summary').click();
  await mobileChatPage.getByLabel('Current entry').selectOption('model:m1-fixture');
  await mobileChatPage.getByLabel('Question', { exact: true }).fill('Does this mobile chat fit the viewport?');
  await mobileChatPage.getByLabel('Alternatives · one per line').fill('It fits\nIt does not fit');
  await mobileChatPage.getByTestId('question-file-input').setInputFiles({ name: 'mobile-note.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 mobile fixture') });
  await mobileChatPage.getByRole('button', { name: 'Submit decision', exact: true }).click();
  await mobileChatPage.getByRole('heading', { name: 'Does this mobile chat fit the viewport?', exact: true }).waitFor();
  assert(Object.values(forwardedAssets ?? {}).some(asset => asset.type === 'file' && asset.mime_type === 'application/pdf' && asset.filename === 'mobile-note.pdf'), 'mobile file picker attachments must reach a configured compatible provider');
  assert.equal(await mobileChatPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  const mobileReplyLayout = await mobileChatPage.evaluate(() => {
    const reply = [...document.querySelectorAll('.decision-response-message')].at(-1)?.getBoundingClientRect();
    const composer = document.querySelector('.decision-chat-composer').getBoundingClientRect();
    const thread = document.querySelector('.decision-chat-thread').getBoundingClientRect();
    const send = document.querySelector('.decision-send-button').getBoundingClientRect();
    return { replyTop: reply?.top ?? -1, replyBottom: reply?.bottom ?? -1, composerTop: composer.top, composerBottom: composer.bottom, sendTop: send.top, sendBottom: send.bottom, threadTop: thread.top, threadBottom: thread.bottom, viewportHeight: innerHeight };
  });
  assert(mobileReplyLayout.replyTop >= mobileReplyLayout.threadTop - 1 && mobileReplyLayout.replyBottom <= mobileReplyLayout.composerTop + 1, `latest reply stays visible above the mobile composer: ${JSON.stringify(mobileReplyLayout)}`);
  assert(mobileReplyLayout.sendTop >= mobileReplyLayout.composerTop && mobileReplyLayout.sendBottom <= mobileReplyLayout.composerBottom && mobileReplyLayout.sendBottom <= mobileReplyLayout.viewportHeight, `mobile send button stays reachable in the composer: ${JSON.stringify(mobileReplyLayout)}`);
  await mobileChatPage.screenshot({ path: path.join(output, 'start-model-chat-390.png'), fullPage: true });
  await mobileChatContext.close();
  check('Start model chat sends from a touch viewport and retains a clean 390px layout');
  } else {
    check('Playwright browser checks explicitly skipped by SYSTORCH_SKIP_UI=1; HTTP, SQLite and daemon restart checks still ran');
  }
  await stop();
  const backup = path.join(output, 'backup-restored'); await cp(root, backup, { recursive: true });
  await start(path.join(backup, 'providers.toml'));
  assert.deepEqual((await request(`${route(task.id)}/result`, caller)).data, result.data);
  check('offline data-directory backup with owner key restores durable authority');
  await stop();
  const keyPath = path.join(backup, 'systorch-owner.key');
  await rename(keyPath, `${keyPath}.retained`);
  await start(path.join(backup, 'providers.toml'));
  assert.equal((await request('/v1/systorch/decisions', caller, body('key-unavailable'))).status, 500);
  assert.equal((await request('/v1/systemone', undefined, { model: 'm1-fixture', state: {}, questions: { ready: { type: 'noul', instructions: 'Synthetic availability' } } })).status, 200);
  await stop(); await rename(`${keyPath}.retained`, keyPath);
  const retainedKey = await readFile(keyPath);
  await writeFile(keyPath, Buffer.alloc(64, 7));
  await start(path.join(backup, 'providers.toml'));
  assert.equal((await request('/v1/systorch/decisions', caller, body('wrong-key'))).status, 500);
  await stop(); await writeFile(keyPath, retainedKey);
  await start(path.join(backup, 'providers.toml'));
  assert.deepEqual((await request(`${route(task.id)}/result`, caller)).data, result.data);
  await stop();
  check('missing/mismatched owner key blocks Choice acceptance without crashing the old model gateway; restoring the key recovers results');
  const db = await readFile(path.join(root, 'systorch.db'));
  assert(!db.includes(Buffer.from('SYNTHETIC_PRIVATE_CONTEXT'))); assert(!db.includes(Buffer.from('Insufficient evidence'))); assert(!db.includes(Buffer.from('CHAT_PRIVATE_SENTINEL')));
  assert(!logs.includes('SYNTHETIC_PRIVATE_CONTEXT')); assert(!logs.includes(owner)); assert(!logs.includes(caller));
  check('no fixture body, answer or credential plaintext in database or daemon logs');
  report.syntheticModelCalls = syntheticModelCalls;
  report.completed = new Date().toISOString(); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error)); throw error;
} finally {
  await browser?.close(); await stop(); await new Promise(resolve => upstream.close(resolve));
  const outputRoot = path.resolve(output) + path.sep;
  if (report.completed && path.resolve(root).startsWith(outputRoot)) await rm(root, { recursive: true, force: true });
}
