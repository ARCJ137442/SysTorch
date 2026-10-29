import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

test('asset references are typed and preserve existing user state', async () => {
  const assets = await loadTs('../src/pages/decisionAssets.ts');
  const wrapped = assets.withAssetReferences({ prompt: 'read this chart' }, ['asset_chart']);
  assert.deepEqual(wrapped, { prompt: 'read this chart', _systorch: { assets: ['asset_chart'] } });
  assert.deepEqual(assets.assetReferences(wrapped, new Set(['asset_chart', 'unused'])), ['asset_chart']);
  assert.deepEqual(assets.withAssetReferences('plain question', []), 'plain question');
  assert.deepEqual(assets.withAssetReferences({ _systorch: { custom: true } }, ['asset_chart']), {
    text: { _systorch: { custom: true } }, _systorch: { assets: ['asset_chart'] },
  });
});

test('small media stays inline while large media uses one reusable uploaded reference', async () => {
  const assets = await loadTs('../src/pages/decisionAssets.ts');
  const small = assets.createDraftAttachments([new File(['hello'], 'note.txt', { type: 'text/plain' })]);
  const smallMap = await assets.buildAssetDescriptors(small);
  assert.equal(smallMap[small[0].reference].data_base64, 'aGVsbG8=');
  assert.equal(smallMap[small[0].reference].type, 'file');

  const inline = assets.createDraftAttachments([
    new File([new Uint8Array([1, 2, 3])], 'diagram.png', { type: 'image/png' }),
    new File([new Uint8Array([4, 5, 6])], 'voice.wav', { type: 'audio/wav' }),
  ]);
  const inlineMap = await assets.buildAssetDescriptors(inline);
  assert.equal(inlineMap[inline[0].reference].type, 'image');
  assert.equal(inlineMap[inline[0].reference].data_base64, 'AQID');
  assert.equal(inlineMap[inline[1].reference].type, 'audio');
  assert.equal(inlineMap[inline[1].reference].mime_type, 'audio/wav');
  assert.equal(inlineMap[inline[1].reference].data_base64, 'BAUG');

  const large = assets.createDraftAttachments([
    new File([new Uint8Array(300 * 1024)], 'clip.webm', { type: 'video/webm' }),
    new File([new Uint8Array(300 * 1024)], 'voice.wav', { type: 'audio/wav' }),
    new File([new Uint8Array(300 * 1024)], 'report.pdf', { type: 'application/pdf' }),
  ]);
  let uploads = 0;
  const upload = async file => ({ asset_id: `asset_uploaded_${++uploads}`, mime_type: file.type, size_bytes: file.size, expires_at: 1 });
  const first = await assets.buildAssetDescriptors(large, undefined, upload);
  const second = await assets.buildAssetDescriptors(large, undefined, upload);
  assert.equal(uploads, 3, 'retrying the same in-memory drafts reuses each upload');
  assert.equal(first[large[0].reference].asset_id, 'asset_uploaded_1');
  assert.equal(second[large[0].reference].type, 'video');
  assert.equal(first[large[1].reference].type, 'audio');
  assert.equal(first[large[2].reference].type, 'file');
  assert.equal(first[large[2].reference].mime_type, 'application/pdf');
  assets.revokeDraftAttachments([...small, ...inline, ...large]);
});
