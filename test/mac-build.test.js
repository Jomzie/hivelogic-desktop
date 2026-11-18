'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCrashRecovery, createLogger } = require('../src/crash-recovery');
const adhoc = require('../build/adhoc-sign.js').default;

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('the Mac build asks macOS for the microphone and camera, so the app is not ended when the page uses them', () => {
  const info = pkg.build.mac.extendInfo;
  assert.match(info.NSMicrophoneUsageDescription, /microphone/i);
  assert.match(info.NSCameraUsageDescription, /camera/i);
  const ent = fs.readFileSync(path.join(root, 'build/entitlements.mac.plist'), 'utf8');
  for (const key of ['com.apple.security.device.audio-input', 'com.apple.security.device.camera', 'com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory']) {
    assert.ok(ent.includes('<key>' + key + '</key>'), key);
  }
  assert.equal(pkg.build.mac.entitlements, 'build/entitlements.mac.plist');
  assert.equal(pkg.build.mac.entitlementsInherit, 'build/entitlements.mac.plist');
  assert.ok(fs.existsSync(path.join(root, pkg.build.mac.icon)), 'the Mac icon file exists');
});

test('one universal Mac file, so nobody has to know their chip', () => {
  assert.equal(pkg.scripts['build:mac'], 'electron-builder --mac --universal');
  assert.deepEqual(pkg.build.mac.target.map((t) => t.target).sort(), ['dmg', 'zip']);
  assert.ok(pkg.build.mac.target.every((t) => t.arch.length === 1 && t.arch[0] === 'universal'));
  assert.equal(pkg.build.win.target[0].target, 'nsis', 'the Windows build is unchanged');
});

test('ad hoc signing only runs for a Mac build when asked, and fails loudly if signing fails', async () => {
  const calls = [];
  const ctx = (platform) => ({ electronPlatformName: platform, appOutDir: '/out', packager: { appInfo: { productFilename: 'HiveLogic' } } });
  delete process.env.HL_ADHOC_SIGN;
  await adhoc(ctx('darwin'), { run: (...a) => calls.push(a) });
  assert.equal(calls.length, 0, 'off unless asked');
  process.env.HL_ADHOC_SIGN = '1';
  await adhoc(ctx('win32'), { run: (...a) => calls.push(a) });
  assert.equal(calls.length, 0, 'never on Windows');
  await adhoc({ ...ctx('darwin'), appOutDir: '/out/mac-universal-x64-temp' }, { run: (...a) => calls.push(a) });
  assert.equal(calls.length, 0, 'the temporary per-chip copies of a universal build stay unsigned');
  await adhoc(ctx('darwin'), { run: (...a) => calls.push(a) });
  assert.deepEqual(calls.map((c) => c[1].slice(0, 3)), [['--force', '--deep', '--sign'], ['--verify', '--deep', '--strict']]);
  assert.ok(calls[0][1].includes('--entitlements') && calls[0][1].some((x) => /entitlements.mac.plist$/.test(x)), 'signed with the entitlements');
  await assert.rejects(adhoc(ctx('darwin'), { run: () => { throw new Error('codesign failed'); } }), /codesign failed/);
  delete process.env.HL_ADHOC_SIGN;
});

test('a page process that dies is reloaded a few times, then the offline page; a clean exit is left alone', () => {
  let t = 0;
  const rec = createCrashRecovery({ now: () => t, maxReloads: 3, windowMs: 1000 });
  assert.equal(rec.onRendererGone({ reason: 'clean-exit' }).action, 'ignore');
  assert.equal(rec.onRendererGone({ reason: 'oom' }).action, 'reload');
  assert.equal(rec.onRendererGone({ reason: 'crashed' }).action, 'reload');
  assert.equal(rec.onRendererGone({ reason: 'crashed' }).action, 'reload');
  assert.equal(rec.onRendererGone({ reason: 'crashed' }).action, 'give-up', 'no reload loop');
  t = 5000;
  assert.equal(rec.onRendererGone({ reason: 'crashed' }).action, 'reload', 'allowed again after the window passes');
  assert.equal(rec.onRendererGone({}).action, 'ignore');
});

test('the log is appended, kept small, and never throws', () => {
  const files = new Map();
  const fsStub = {
    mkdirSync() {}, statSync: (f) => { if (!files.has(f)) throw new Error('none'); return { size: files.get(f).length }; },
    renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); },
    appendFileSync: (f, s) => files.set(f, (files.get(f) || '') + s),
  };
  const log = createLogger('/logs', { fs: fsStub, now: () => new Date('2026-11-18T10:00:00Z') });
  log('page process gone: oom (exit 9) -> reload');
  const f = [...files.keys()][0];
  assert.match(files.get(f), /^2026-11-18T10:00:00.000Z page process gone: oom/);
  files.set(f, 'x'.repeat(1024 * 1024 + 1)); log('after rotate');
  assert.ok(files.has(f + '.old')); assert.match(files.get(f), /after rotate/);
  assert.doesNotThrow(() => createLogger('/logs', { fs: { mkdirSync() { throw new Error('read-only'); } } })('x'));
});
