'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TRUSTED_APP_ORIGIN,
  installCallMediaPolicy,
  isAllowedCallMediaCheck,
  isAllowedCallMediaRequest,
} = require('../src/permissions');
const { installDisplayCapture, SCREEN_SETTINGS_URL } = require('../src/display-capture');

const req = (permission, mediaTypes, url = TRUSTED_APP_ORIGIN) =>
  isAllowedCallMediaRequest(permission, { requestingUrl: url, mediaTypes });

test('calls may use the microphone, the camera, or both, from the HiveLogic site', () => {
  assert.equal(req('media', ['audio']), true);
  assert.equal(req('media', ['video']), true);
  assert.equal(req('media', ['audio', 'video']), true);
  assert.equal(isAllowedCallMediaCheck('media', TRUSTED_APP_ORIGIN, { mediaType: 'video' }), true);
  assert.equal(isAllowedCallMediaCheck('media', TRUSTED_APP_ORIGIN, { mediaType: 'audio' }), true);
});

test('screen capture is allowed only from the HiveLogic site', () => {
  assert.equal(req('display-capture', undefined), true);
  assert.equal(req('display-capture', undefined, 'https://example.com'), false);
  assert.equal(isAllowedCallMediaCheck('display-capture', TRUSTED_APP_ORIGIN, {}), true);
  assert.equal(isAllowedCallMediaCheck('display-capture', 'https://example.com', {}), false);
});

test('everything else is still refused: other sites, other permissions, unknown media, empty requests', () => {
  assert.equal(req('media', ['audio'], 'https://example.com'), false);
  assert.equal(req('media', ['video'], 'https://hivelogic-live.vercel.app.evil.test'), false);
  assert.equal(req('media', ['audio'], 'file:///offline.html'), false);
  assert.equal(req('geolocation', ['audio']), false);
  assert.equal(req('notifications', ['audio']), false);
  assert.equal(req('media', ['audio', 'screen']), false);
  assert.equal(req('media', []), false);
  assert.equal(req('media', undefined), false);
  assert.equal(isAllowedCallMediaCheck('media', TRUSTED_APP_ORIGIN, {}), false);
});

test('the installed handlers answer once and fail closed', () => {
  let requestHandler;
  let checkHandler;
  installCallMediaPolicy({
    setPermissionRequestHandler(v) { requestHandler = v; },
    setPermissionCheckHandler(v) { checkHandler = v; },
  });
  const answers = [];
  requestHandler(null, 'media', (a) => answers.push(a), { requestingUrl: TRUSTED_APP_ORIGIN, mediaTypes: ['video'] });
  requestHandler(null, 'media', (a) => answers.push(a), { requestingUrl: 'https://example.com', mediaTypes: ['video'] });
  requestHandler(null, 'media', (a) => answers.push(a), null);
  assert.deepEqual(answers, [true, false, false]);
  assert.equal(checkHandler(null, 'media', TRUSTED_APP_ORIGIN, { mediaType: 'video' }), true);
  assert.equal(checkHandler(null, 'media', 'https://example.com', { mediaType: 'video' }), false);
});

// ---- screen sharing handler ---------------------------------------------------------------------------------
function share({ platform = 'darwin', status = 'granted', sources, response = 0, origin = TRUSTED_APP_ORIGIN, throwOn } = {}) {
  let handler;
  let options;
  const dialogs = [];
  const opened = [];
  installDisplayCapture(
    { setDisplayMediaRequestHandler(h, o) { handler = h; options = o; } },
    {
      platform,
      desktopCapturer: { getSources: async () => { if (throwOn === 'sources') throw new Error('x'); return sources || [{ id: 'screen:1', name: 'Entire screen' }]; } },
      dialog: { showMessageBox: async (_p, o) => { dialogs.push(o); return { response: typeof response === 'function' ? response(o) : response }; } },
      systemPreferences: { getMediaAccessStatus: () => status },
      shell: { openExternal: (u) => opened.push(u) },
      BrowserWindow: { fromWebContents: () => undefined },
    },
    TRUSTED_APP_ORIGIN
  );
  const run = () => new Promise((resolve) => handler({ frame: { url: origin } }, (v) => resolve(v)));
  return { run, dialogs, opened, options: () => options };
}

test('Share screen asks first, then shares the screen that was picked', async () => {
  const s = share({ sources: [{ id: 'screen:1', name: 'Screen 1' }, { id: 'screen:2', name: 'Screen 2' }], response: 1 });
  const out = await s.run();
  assert.deepEqual(out, { video: { id: 'screen:2', name: 'Screen 2' } });
  assert.equal(s.dialogs.length, 1);
  assert.deepEqual(s.dialogs[0].buttons, ['Screen 1', 'Screen 2', 'Cancel']);
});

test('one screen: a single "Share my screen" button; Cancel shares nothing', async () => {
  const yes = share({ response: 0 });
  assert.deepEqual(await yes.run(), { video: { id: 'screen:1', name: 'Entire screen' } });
  assert.deepEqual(yes.dialogs[0].buttons, ['Share my screen', 'Cancel']);
  const no = share({ response: 1 });
  assert.deepEqual(await no.run(), {});
});

test('the system picker is used where macOS offers it', () => {
  assert.deepEqual(share().options(), { useSystemPicker: true });
});

test('macOS with Screen Recording off: say so, open System Settings on request, share nothing', async () => {
  const s = share({ status: 'denied', response: 0 });
  assert.deepEqual(await s.run(), {});
  assert.match(s.dialogs[0].message, /Screen Recording/);
  assert.deepEqual(s.opened, [SCREEN_SETTINGS_URL]);
  const cancel = share({ status: 'denied', response: 1 });
  assert.deepEqual(await cancel.run(), {});
  assert.deepEqual(cancel.opened, []);
});

test('Windows skips the macOS check', async () => {
  const s = share({ platform: 'win32', status: 'denied', response: 0 });
  assert.deepEqual(await s.run(), { video: { id: 'screen:1', name: 'Entire screen' } });
});

test('another site, no screens, or an error: nothing is shared and no dialog is shown for the other site', async () => {
  const other = share({ origin: 'https://example.com' });
  assert.deepEqual(await other.run(), {});
  assert.equal(other.dialogs.length, 0);
  const none = share({ sources: [] });
  assert.deepEqual(await none.run(), {});
  const boom = share({ throwOn: 'sources' });
  assert.deepEqual(await boom.run(), {});
});
