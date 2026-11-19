'use strict';

const TRUSTED_APP_ORIGIN = 'https://hivelogic-live.vercel.app';

function readOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    return new URL(value).origin;
  } catch (_) {
    return null;
  }
}

function isTrustedOrigin(value, trustedOrigin = TRUSTED_APP_ORIGIN) {
  return readOrigin(value) === trustedOrigin;
}

function isTrustedIpcSender(event, trustedOrigin = TRUSTED_APP_ORIGIN) {
  try {
    const senderUrl =
      (event && event.senderFrame && event.senderFrame.url) ||
      (event && event.sender && typeof event.sender.getURL === 'function'
        ? event.sender.getURL()
        : '');
    return isTrustedOrigin(senderUrl, trustedOrigin);
  } catch (_) {
    return false;
  }
}

function isExactAudioMediaRequest(permission, details) {
  if (permission !== 'media' || !details || typeof details !== 'object') {
    return false;
  }

  if (Array.isArray(details.mediaTypes)) {
    return (
      details.mediaTypes.length === 1 &&
      details.mediaTypes[0] === 'audio'
    );
  }

  return details.mediaType === 'audio';
}

function isAllowedAudioPermissionRequest(
  permission,
  details,
  trustedOrigin = TRUSTED_APP_ORIGIN
) {
  if (!isExactAudioMediaRequest(permission, details)) return false;
  const requestingUrl = details.requestingUrl || details.securityOrigin || '';
  return isTrustedOrigin(requestingUrl, trustedOrigin);
}

function isAllowedAudioPermissionCheck(
  permission,
  requestingOrigin,
  details,
  trustedOrigin = TRUSTED_APP_ORIGIN
) {
  return (
    isExactAudioMediaRequest(permission, details) &&
    isTrustedOrigin(requestingOrigin, trustedOrigin)
  );
}

function installAudioPermissionPolicy(
  electronSession,
  trustedOrigin = TRUSTED_APP_ORIGIN
) {
  electronSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      let allowed = false;
      try {
        allowed = isAllowedAudioPermissionRequest(
          permission,
          details,
          trustedOrigin
        );
      } catch (_) {
        allowed = false;
      }
      callback(allowed);
    }
  );

  electronSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      try {
        return isAllowedAudioPermissionCheck(
          permission,
          requestingOrigin,
          details,
          trustedOrigin
        );
      } catch (_) {
        return false;
      }
    }
  );
}

/* Calls: microphone, camera and screen sharing from the HiveLogic site only.
   Added for the Mac test build (2026-11-20): Kevin could not turn on his camera or share his screen in a HiveConnect call, because the app
   allowed the microphone alone. Every request still has to come from the exact HiveLogic origin, and only the media kinds below are allowed. */
function callMediaKinds(details) {
  if (!details || typeof details !== 'object') return [];
  if (Array.isArray(details.mediaTypes)) return details.mediaTypes;
  return details.mediaType ? [details.mediaType] : [];
}

function isAllowedCallMediaRequest(permission, details, trustedOrigin = TRUSTED_APP_ORIGIN) {
  if (permission !== 'media' && permission !== 'display-capture') return false;
  const requestingUrl = (details && (details.requestingUrl || details.securityOrigin)) || '';
  if (!isTrustedOrigin(requestingUrl, trustedOrigin)) return false;
  if (permission === 'display-capture') return true;
  const kinds = callMediaKinds(details);
  return kinds.length > 0 && kinds.every((k) => k === 'audio' || k === 'video');
}

function isAllowedCallMediaCheck(permission, requestingOrigin, details, trustedOrigin = TRUSTED_APP_ORIGIN) {
  if (permission !== 'media' && permission !== 'display-capture') return false;
  if (!isTrustedOrigin(requestingOrigin, trustedOrigin)) return false;
  if (permission === 'display-capture') return true;
  const kinds = callMediaKinds(details);
  return kinds.length > 0 && kinds.every((k) => k === 'audio' || k === 'video');
}

function installCallMediaPolicy(electronSession, trustedOrigin = TRUSTED_APP_ORIGIN) {
  electronSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    let allowed = false;
    try {
      allowed = isAllowedCallMediaRequest(permission, details, trustedOrigin);
    } catch (_) {
      allowed = false;
    }
    callback(allowed);
  });
  electronSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    try {
      return isAllowedCallMediaCheck(permission, requestingOrigin, details, trustedOrigin);
    } catch (_) {
      return false;
    }
  });
}

module.exports = {
  TRUSTED_APP_ORIGIN,
  installCallMediaPolicy,
  isAllowedCallMediaRequest,
  isAllowedCallMediaCheck,
  installAudioPermissionPolicy,
  isAllowedAudioPermissionCheck,
  isAllowedAudioPermissionRequest,
  isExactAudioMediaRequest,
  isTrustedIpcSender,
  isTrustedOrigin,
};
