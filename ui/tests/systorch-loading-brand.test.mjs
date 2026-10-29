import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('native waiting screen uses the canonical SysTorch torch mark without a Jev/J glyph fallback', async () => {
  const [waiting, shellIcon, canonicalIcon, config] = await Promise.all([
    readFile(path.join(repo, 'src-tauri/shell/waiting.html'), 'utf8'),
    readFile(path.join(repo, 'src-tauri/shell/icon.svg'), 'utf8'),
    readFile(path.join(repo, 'src-tauri/app-icon.svg'), 'utf8'),
    readFile(path.join(repo, 'src-tauri/tauri.conf.json'), 'utf8'),
  ]);
  assert.match(config, /"url"\s*:\s*"waiting\.html"/);
  assert.match(waiting, /<img class="mark" src="icon\.svg"/);
  assert.doesNotMatch(waiting, /class="mark"[^>]*>\s*J\s*</);
  assert.equal(shellIcon, canonicalIcon, 'the native loader and app icon share one maintained SVG identity');
});
