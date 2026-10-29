/**
 * Client-Side Browser & Device Detection Engine for AnonConnect
 * Gathers privacy-safe hardware, OS, and browser parameters to track device login sessions.
 */

const STORAGE_DEVICE_KEY = 'aconnect_device_id';

export function getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem(STORAGE_DEVICE_KEY);
    if (!id || typeof id !== 'string') {
      id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
      localStorage.setItem(STORAGE_DEVICE_KEY, id);
    }
  } catch (_) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }
  return id;
}

export function getDeviceInfo() {
  const deviceId = getDeviceId();
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  const screenW = typeof window !== 'undefined' && window.screen ? window.screen.width : 0;
  const screenH = typeof window !== 'undefined' && window.screen ? window.screen.height : 0;
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const touch = typeof navigator !== 'undefined' ? (navigator.maxTouchPoints > 0) : false;

  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (_) {}

  const language = typeof navigator !== 'undefined' ? (navigator.language || 'en') : 'en';

  // 1. Operating System Detection
  let os = 'Unknown OS';
  if (/iPad|iPhone|iPod/.test(ua)) {
    const match = ua.match(/OS (\d+[._]\d+)/);
    os = 'iOS' + (match ? ' ' + match[1].replace(/_/g, '.') : '');
  } else if (/Android/.test(ua)) {
    const match = ua.match(/Android\s+([\d.]+)/);
    os = 'Android' + (match ? ' ' + match[1] : '');
  } else if (/Windows NT 10.0/.test(ua)) {
    os = 'Windows 10/11';
  } else if (/Windows NT 6.3/.test(ua)) {
    os = 'Windows 8.1';
  } else if (/Windows NT 6.1/.test(ua)) {
    os = 'Windows 7';
  } else if (/Windows/.test(ua)) {
    os = 'Windows';
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    const match = ua.match(/Mac OS X\s+([\d_]+)/);
    os = 'macOS' + (match ? ' ' + match[1].replace(/_/g, '.') : '');
  } else if (/CrOS/.test(ua)) {
    os = 'ChromeOS';
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  }

  // 2. Browser Detection
  let browser = 'Unknown Browser';
  if (/Brave/i.test(ua) || (typeof navigator !== 'undefined' && navigator.brave)) {
    browser = 'Brave';
  } else if (/Edg\//i.test(ua)) {
    const match = ua.match(/Edg\/([\d.]+)/);
    browser = 'Edge' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/OPR\/|Opera/i.test(ua)) {
    const match = ua.match(/(?:OPR|Opera)\/([\d.]+)/);
    browser = 'Opera' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/SamsungBrowser/i.test(ua)) {
    const match = ua.match(/SamsungBrowser\/([\d.]+)/);
    browser = 'Samsung Internet' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/CriOS\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/CriOS\/([\d.]+)/);
    browser = 'Chrome iOS' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Chrome\/([\d.]+)/i.test(ua) && !/Mobile Safari/i.test(ua)) {
    const match = ua.match(/Chrome\/([\d.]+)/);
    browser = 'Chrome' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Firefox\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/Firefox\/([\d.]+)/);
    browser = 'Firefox' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/FxiOS\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/FxiOS\/([\d.]+)/);
    browser = 'Firefox iOS' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Safari/i.test(ua) && /Version\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/Version\/([\d.]+)/);
    browser = 'Safari' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Chrome/i.test(ua)) {
    browser = 'Chrome Mobile';
  }

  // 3. Device Form Factor & Model Detection
  let deviceType = 'desktop';
  let deviceModel = 'Desktop PC';

  if (/tablet|ipad|playbook|silk/i.test(ua) || (touch && screenW >= 768 && screenW <= 1366)) {
    deviceType = 'tablet';
    deviceModel = /iPad/i.test(ua) ? 'Apple iPad' : 'Tablet Device';
  } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry/i.test(ua) || (touch && screenW < 768)) {
    deviceType = 'mobile';
    if (/iPhone/i.test(ua)) {
      deviceModel = 'Apple iPhone';
    } else if (/Pixel/i.test(ua)) {
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
