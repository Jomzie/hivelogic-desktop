// electron-builder afterPack hook: give the Mac app a basic ("ad hoc") signature when Apple signing is not set up.
//
// Why: an app with NO signature, downloaded in a browser, opens as "HiveLogic is damaged and can't be opened" on current Macs.
// With an ad hoc signature it opens with the normal "unidentified developer" prompt: right-click the app, choose Open, once.
// This is NOT Apple notarization. Real signing (CSC_LINK + Apple secrets) replaces this: the hook steps aside unless
// HL_ADHOC_SIGN=1, and the workflow only sets that on the unsigned path.
//
// Runs once per architecture after the app folder is built and before the dmg and zip are made. The build fails loudly if
// signing fails; an unsigned file must never be handed out as if it were fine.
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');

exports.default = async function adhocSign(context, deps = {}) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.HL_ADHOC_SIGN !== '1') return;
  // A universal app is made by merging a per-chip copy of each kind. Those temporary copies must stay unsigned: two signed copies
  // never match byte for byte and the merge refuses. Only the final app (appOutDir without -temp) is signed.
  if (/-temp$/.test(context.appOutDir)) return;
  const run = deps.run || execFileSync;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // The entitlements go in with the signature: a signature made without them carries none, and the microphone and camera
  // entries would be lost from the finished app.
  const entitlements = path.join(__dirname, 'entitlements.mac.plist');
  run('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, app], { stdio: 'inherit' });
  run('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`Ad hoc signed ${app}`);
};
