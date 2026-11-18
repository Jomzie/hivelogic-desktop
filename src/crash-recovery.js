'use strict';
// What to do when the page's process dies, and a small log file so a crash can be read afterwards.
//
// Why: the macOS build used to just vanish with no message and no report. Now a page process that dies is reloaded (a few
// times, then the offline page with its Retry button instead of a reload loop), and the reason is written to
// ~/Library/Logs/HiveLogic/hivelogic.log so the next crash tells us what happened. No Electron import here: the main process
// hands in everything it touches, so this stays unit-testable.
const fs = require('fs');
const path = require('path');

const RELOAD_REASONS = new Set(['crashed', 'oom', 'abnormal-exit', 'launch-failed', 'killed', 'integrity-failure']);

function createCrashRecovery(options = {}) {
  const now = options.now || Date.now;
  const maxReloads = options.maxReloads || 3;
  const windowMs = options.windowMs || 5 * 60 * 1000;
  let times = [];
  return {
    // -> { action: 'ignore' | 'reload' | 'give-up', reason, count }
    onRendererGone(details) {
      const reason = (details && details.reason) || 'unknown';
      if (reason === 'clean-exit' || !RELOAD_REASONS.has(reason)) return { action: 'ignore', reason, count: times.length };
      const t = now();
      times = times.filter((x) => t - x < windowMs);
      if (times.length >= maxReloads) return { action: 'give-up', reason, count: times.length };
      times.push(t);
      return { action: 'reload', reason, count: times.length };
    },
  };
}

const MAX_LOG_BYTES = 1024 * 1024;

function createLogger(dir, deps = {}) {
  const fsImpl = deps.fs || fs;
  const now = deps.now || (() => new Date());
  const file = path.join(dir, 'hivelogic.log');
  return function log(message) {
    try {
      fsImpl.mkdirSync(dir, { recursive: true });
      try {
        if (fsImpl.statSync(file).size > MAX_LOG_BYTES) fsImpl.renameSync(file, file + '.old');
      } catch (_) { /* no log yet */ }
      fsImpl.appendFileSync(file, `${now().toISOString()} ${String(message).slice(0, 2000)}\n`);
    } catch (_) { /* a log that cannot be written must never take the app down */ }
  };
}

module.exports = { createCrashRecovery, createLogger, RELOAD_REASONS, MAX_LOG_BYTES };
