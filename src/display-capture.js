'use strict';

/* Screen sharing in calls.
   A HiveConnect call asks the page for getDisplayMedia(). Electron refuses that unless the app answers it, so before this file "Share screen" did
   nothing. Here the app answers it, once per request:
     - macOS 15 and newer: the system's own picker (screens and windows), which Electron shows when useSystemPicker is on.
     - Older macOS and Windows: a plain confirm that names the screen being shared, one button per screen when there are several.
   macOS also needs "Screen Recording" turned on for HiveLogic. When it is off, a dialog says so and opens that settings page instead of failing quietly.
   Only the HiveLogic site can ask, and nothing is ever shared without a click on one of these buttons. */

const { isTrustedOrigin } = require('./permissions');

const SCREEN_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

function requestOrigin(request) {
  try {
    const frame = request && request.frame;
    return (frame && frame.url) || (request && request.securityOrigin) || '';
  } catch (_) {
    return '';
  }
}

/* The label on a screen's button: "Screen 1 (main)", "Screen 2". */
function screenLabel(source, index) {
  const name = String((source && source.name) || '').trim();
  return name ? name : 'Screen ' + (index + 1);
}

function installDisplayCapture(electronSession, deps, trustedOrigin) {
  const { desktopCapturer, dialog, systemPreferences, shell, BrowserWindow, platform, log } = deps;
  const note = (m) => { try { if (typeof log === 'function') log(m); } catch (_) { /* logging must never break a share */ } };
  const os = platform || process.platform;

  electronSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      let answered = false;
      const answer = (value) => {
        if (answered) return;
        answered = true;
        if (value) callback(value);
        else callback({});
      };
      try {
        if (!isTrustedOrigin(requestOrigin(request), trustedOrigin)) {
          note('screen share refused: not the HiveLogic site');
          return answer(null);
        }

        // The window the question sits on. A lookup that fails must never end the share, so it has its own guard: the app's focused window, or none.
        let parent;
        try {
          parent = (BrowserWindow && BrowserWindow.getFocusedWindow && BrowserWindow.getFocusedWindow()) || undefined;
        } catch (_) {
          parent = undefined;
        }
        note('screen share asked for');

        // macOS: Screen Recording must be on for this app, or the capture is a black picture.
        if (os === 'darwin' && systemPreferences && systemPreferences.getMediaAccessStatus) {
          const status = systemPreferences.getMediaAccessStatus('screen');
          note('screen recording permission: ' + status);
          if (status === 'denied' || status === 'restricted') {
            const pick = await dialog.showMessageBox(parent, {
              type: 'info',
              message: 'Turn on Screen Recording for HiveLogic',
              detail: 'To share your screen, open System Settings, then Privacy & Security, then Screen Recording, and switch HiveLogic on. Then quit HiveLogic (Cmd+Q) and open it again.',
              buttons: ['Open System Settings', 'Cancel'],
              defaultId: 0,
              cancelId: 1,
            });
            if (pick.response === 0 && shell) shell.openExternal(SCREEN_SETTINGS_URL);
            return answer(null);
          }
        }

        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        note('screens found: ' + (sources ? sources.length : 0));
        if (!sources || !sources.length) return answer(null);

        // Up to four screens get a button each; more than that shares the first and says so in the label.
        const choices = sources.slice(0, 4);
        const buttons = choices.length === 1 ? ['Share my screen'] : choices.map(screenLabel);
        buttons.push('Cancel');
        const result = await dialog.showMessageBox(parent, {
          type: 'question',
          message: 'Share your screen on this call?',
          detail: 'Everyone on the call will see what is on the screen you pick, until you stop sharing.',
          buttons,
          defaultId: 0,
          cancelId: buttons.length - 1,
        });
        if (result.response >= choices.length) {
          note('screen share cancelled');
          return answer(null);
        }
        note('screen share started');
        return answer({ video: choices[result.response] });
      } catch (e) {
        note('screen share failed: ' + (e && e.message ? e.message : e));
        return answer(null);
      }
    },
    { useSystemPicker: true }
  );
}

module.exports = { installDisplayCapture, screenLabel, SCREEN_SETTINGS_URL };
