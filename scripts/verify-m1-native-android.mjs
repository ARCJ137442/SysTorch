// Own emulator only. Never operate a physical device or the shared development AVD.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const adb = process.env.M1_ADB ?? 'adb';
const serial = '127.0.0.1:5583';
const port = '5041';
const pkg = 'io.github.arcj137442.jevswitch.m1preview';
const apk = path.resolve('.tmp/m1-delivery/jev-switch-m1-preview-x86_64.apk');
const output = path.resolve('.tmp/m1-native-android'); await mkdir(output, { recursive: true });
const command = (...args) => execFileSync(adb, ['-P', port, '-s', serial, ...args], { windowsHide: true, timeout: 60000, encoding: 'utf8' });
const avd = command('shell', 'getprop', 'ro.boot.qemu.avd_name').trim() || command('shell', 'getprop', 'ro.kernel.qemu.avd_name').trim();
assert.equal(avd, 'SysTorch_M1_API_35', 'Only the dedicated temporary M1 AVD may be tested');
const base = 'http://127.0.0.1:18438';
const report = { scope: 'real Android x86_64 release APK, isolated API 35 emulator and native owner bridge', apkSha256: createHash('sha256').update(await readFile(apk)).digest('hex'), checks: [], realModelCalls: 0 };
const record = name => { report.checks.push(name); console.log(`PASS ${name}`); };
async function waitFor(action, seconds = 30) {
  const until = performance.now() + seconds * 1000;
  let last;
  while (performance.now() < until) { try { const result = await action(); if (result) return result; } catch (error) { last = error; } await new Promise(resolve => setTimeout(resolve, 200)); }
  throw last ?? Error('Android condition deadline exceeded');
}
async function request(url, token, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000) });
  return { status: response.status, data: await response.json() };
}
function dump() { command('shell', 'uiautomator', 'dump', '/sdcard/systorch-m1-window.xml'); return command('shell', 'cat', '/sdcard/systorch-m1-window.xml'); }
const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function find(xml, text) {
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const attrs = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
    if ((attrs.text !== text && attrs['content-desc'] !== text) || attrs.enabled === 'false') continue;
    const bounds = attrs.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)?.slice(1).map(Number);
    if (bounds && bounds[2] > bounds[0] && bounds[3] > bounds[1]) return bounds;
  }
  return null;
}
async function tapText(text, navigation = false) {
  let bounds;
  for (let i = 0; i < 6; i++) {
    bounds = await waitFor(() => find(dump(), text));
    if (navigation || (bounds[1] >= 600 && bounds[3] <= 2100)) break;
    command('shell', 'input', 'swipe', '550', bounds[3] > 2100 ? '1800' : '900', '550', bounds[3] > 2100 ? '900' : '1800', '450');
  }
  assert(bounds, `Visible enabled target: ${text}`);
  command('shell', 'input', 'tap', String(Math.round((bounds[0] + bounds[2]) / 2)), String(Math.round((bounds[1] + bounds[3]) / 2)));
}
const sample = key => ({ entry: 'human:owner', idempotency_key: key, question: 'Native Android M1 fixture', context: { source: 'isolated emulator fixture' }, choices: [{ id: 'review', label: 'Review fixture' }, { id: 'continue', label: 'Continue testing' }], ttl_seconds: 3600 });
try {
  command('shell','input','keyevent','KEYCODE_WAKEUP');
  command('shell','wm','dismiss-keyguard');
  command('shell','settings','put','system','screen_off_timeout','1800000');
  command('install', '--no-incremental', '-r', apk);
  command('shell', 'am', 'force-stop', pkg);
  command('shell', 'pm', 'clear', pkg);
  // This disposable Play image can retain a factory Messages ANR after boot;
  // close only that unrelated factory app, never suppress this app's ANRs.
  command('shell','am','force-stop','com.google.android.apps.messaging');
  command('forward', 'tcp:18438', 'tcp:11436');
  command('shell', 'am', 'start', '-n', `${pkg}/io.github.arcj137442.jevswitch.MainActivity`);
  const health = await waitFor(async () => { const value = await request('/health'); return value.status === 200 && value.data; }, 60);
  report.buildRevision = health.build_revision;
  record('fresh native seed parses and the embedded gateway really listens on 11436');
  const token = (await request('/v1/admin/tokens', undefined, { name: 'M1 emulator caller', role: 'readonly' })).data.secret;
  assert.equal(typeof token, 'string');
  const task = (await request('/v1/systorch/decisions', token, sample('android-native-answer'))).data;
  assert(task.id);
  await waitFor(() => dump().includes('Local owner · can answer'), 40);
  record('native Android owner credential automatically authorizes the decision desk');
  await tapText('Decision desk', true);
  await tapText('Review fixture');
  assert.equal((await request(`/v1/systorch/decisions/${task.id}`, token)).data.status, 'pending');
  // Scroll only this app's content if the explicit submit action is below the fold.
  let xml = dump();
  for (let i = 0; i < 5 && !find(xml, 'Submit answer'); i++) {
    command('shell', 'input', 'swipe', '550', '1800', '550', '900', '450'); xml = dump();
  }
  await tapText('Submit answer');
  const result = await waitFor(async () => { const r = await request(`/v1/systorch/decisions/${task.id}/result`, token); return r.status === 200 && r.data; });
  assert.equal(result.answers.choice.choice, 'review');
  record('external submit → native UI radio draft → explicit human submit → external strict result');
  command('shell', 'screencap', '-p', '/sdcard/systorch-m1-answer.png');
  command('pull', '/sdcard/systorch-m1-answer.png', path.join(output, 'android-answer.png'));
  const pending = (await request('/v1/systorch/decisions', token, sample('android-native-restart'))).data;
  command('shell', 'am', 'force-stop', pkg);
  command('shell', 'am', 'start', '-n', `${pkg}/io.github.arcj137442.jevswitch.MainActivity`);
  await waitFor(async () => (await request('/health')).status === 200, 40);
  assert.equal((await request(`/v1/systorch/decisions/${pending.id}`, token)).data.status, 'pending');
  assert.deepEqual((await request(`/v1/systorch/decisions/${task.id}/result`, token)).data, result);
  record('force-stop / cold restart retains both a waiting task and an accepted result');
  report.completed = new Date().toISOString(); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(path.join(output, 'failure.txt'), String(error.stack ?? error));
  try { await writeFile(path.join(output, 'failure.xml'), dump()); command('shell', 'screencap', '-p', '/sdcard/systorch-m1-failure.png'); command('pull', '/sdcard/systorch-m1-failure.png', path.join(output, 'failure.png')); } catch { /* Preserve the original failure. */ }
  throw error;
} finally {
  try { command('shell', 'am', 'force-stop', pkg); command('forward', '--remove', 'tcp:18438'); } catch { /* Only owned test resources. */ }
}
