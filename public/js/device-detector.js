/**
 * Client-Side Browser & Device Detection Engine for AnonConnect
 * Gathers privacy-safe hardware, OS, and browser parameters to track device login sessions.
 */

const STORAGE_DEVICE_KEY = 'aconnect_device_id';
let memoryDeviceId = null;

export function getDeviceId() {
  if (memoryDeviceId) return memoryDeviceId;

  let id = null;
  try {
    id = localStorage.getItem(STORAGE_DEVICE_KEY);
    if (!id || typeof id !== 'string') {
      try {
        id = sessionStorage.getItem(STORAGE_DEVICE_KEY);
      } catch (_) {}
    }
    if (!id || typeof id !== 'string') {
      id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
      try { localStorage.setItem(STORAGE_DEVICE_KEY, id); } catch (_) {}
      try { sessionStorage.setItem(STORAGE_DEVICE_KEY, id); } catch (_) {}
    }
  } catch (_) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  memoryDeviceId = id;
  return id;
}

export function getDeviceInfo() {
  const deviceId = getDeviceId();
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  const screenW = typeof window !== 'undefined' && window.screen ? window.screen.width : 0;
  const screenH = typeof window !== 'undefined' && window.screen ? window.screen.height : 0;
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const maxTouch = typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
  const touch = maxTouch > 0;

  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (_) {}

  const language = typeof navigator !== 'undefined' ? (navigator.language || 'en') : 'en';

  // 1. Operating System Detection
  let os = 'Unknown OS';
  const isIOSNative = /iPad|iPhone|iPod/i.test(ua);
  const isIOSDesktopMode = /Macintosh|Mac OS X/i.test(ua) && touch && maxTouch > 1;

  if (isIOSNative) {
    const match = ua.match(/OS (\d+[._]\d+)/);
    os = 'iOS' + (match ? ' ' + match[1].replace(/_/g, '.') : '');
  } else if (isIOSDesktopMode) {
    os = 'iOS (Desktop Mode)';
  } else if (/Android/i.test(ua)) {
    const match = ua.match(/Android\s+([\d.]+)/i);
    os = 'Android' + (match ? ' ' + match[1] : '');
  } else if (/Windows NT 10.0/i.test(ua)) {
    os = 'Windows 10/11';
  } else if (/Windows NT 6.3/i.test(ua)) {
    os = 'Windows 8.1';
  } else if (/Windows NT 6.1/i.test(ua)) {
    os = 'Windows 7';
  } else if (/Windows/i.test(ua)) {
    os = 'Windows';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    const match = ua.match(/Mac OS X\s+([\d_]+)/i);
    os = 'macOS' + (match ? ' ' + match[1].replace(/_/g, '.') : '');
  } else if (/CrOS/i.test(ua)) {
    os = 'ChromeOS';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  }

  // 2. Browser Detection
  let browser = 'Unknown Browser';
  if (/Brave/i.test(ua) || (typeof navigator !== 'undefined' && navigator.brave)) {
    browser = 'Brave';
  } else if (/EdgiOS\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/EdgiOS\/([\d.]+)/i);
    browser = 'Edge iOS' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Edg\//i.test(ua)) {
    const match = ua.match(/Edg\/([\d.]+)/i);
    browser = 'Edge' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/OPR\/|Opera/i.test(ua)) {
    const match = ua.match(/(?:OPR|Opera)\/([\d.]+)/i);
    browser = 'Opera' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/SamsungBrowser/i.test(ua)) {
    const match = ua.match(/SamsungBrowser\/([\d.]+)/i);
    browser = 'Samsung Internet' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/CriOS\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/CriOS\/([\d.]+)/i);
    browser = 'Chrome iOS' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/FxiOS\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/FxiOS\/([\d.]+)/i);
    browser = 'Firefox iOS' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Chrome\/([\d.]+)/i.test(ua) && !/Mobile Safari/i.test(ua)) {
    const match = ua.match(/Chrome\/([\d.]+)/i);
    browser = 'Chrome' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Firefox\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/Firefox\/([\d.]+)/i);
    browser = 'Firefox' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Safari/i.test(ua) && /Version\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/Version\/([\d.]+)/i);
    browser = 'Safari' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Safari/i.test(ua)) {
    browser = 'Safari';
  } else if (/Chrome/i.test(ua)) {
    browser = 'Chrome Mobile';
  }

  // 3. Device Form Factor & Model Detection
  let deviceType = 'desktop';
  let deviceModel = 'Desktop PC';

  if (/iPad/i.test(ua) || (isIOSDesktopMode && screenW >= 768)) {
    deviceType = 'tablet';
    deviceModel = 'Apple iPad';
  } else if (/iPhone/i.test(ua) || (isIOSDesktopMode && screenW < 768) || (isIOSNative && !/iPad/i.test(ua))) {
    deviceType = 'mobile';
    deviceModel = 'Apple iPhone';
  } else if (/tablet|playbook|silk/i.test(ua) || (touch && screenW >= 768 && screenW <= 1366)) {
    deviceType = 'tablet';
    deviceModel = 'Tablet Device';
  } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry/i.test(ua) || (touch && screenW < 768)) {
    deviceType = 'mobile';
    if (/Pixel/i.test(ua)) {
      deviceModel = 'Google Pixel';
    } else if (/Samsung|SM-|GT-/i.test(ua)) {
      deviceModel = 'Samsung Galaxy';
    } else {
      deviceModel = 'Mobile Smartphone';
    }
  } else {
    deviceType = 'desktop';
    if (/Macintosh/i.test(ua)) {
      deviceModel = 'Apple Mac';
    } else if (/Windows/i.test(ua)) {
      deviceModel = 'Windows PC';
    } else if (/Linux/i.test(ua)) {
      deviceModel = 'Linux Workstation';
    }
  }

  const deviceName = `${deviceModel} (${os} • ${browser})`;
  const screenStr = screenW > 0 ? `${screenW}×${screenH} (${dpr}x)` : 'N/A';

  return {
    deviceId,
    deviceName,
    deviceModel,
    deviceType,
    os,
    browser,
    screen: screenStr,
    timezone,
    language,
    touch,
    userAgent: ua
  };
}

/**
 * Sends a lightweight HTTP heartbeat to register device activity on the server immediately,
 * even if WebSockets are connecting or screen is locked.
 */
export async function sendDeviceHeartbeat(action = 'Session Connected') {
  try {
    const info = getDeviceInfo();
    await fetch('/api/history/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...info, action })
    });
  } catch (_) {}
}
