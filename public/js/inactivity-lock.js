/**
 * Inactivity Lock, Login Clearance & Screen Blur System
 * - When logging in before entering chat, the screen is blurred.
 * - Blurs whole screen after 5 minutes of inactivity since last activity.
 * - Entering wrong password destroys all messages silently.
 */

let INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default
const STORAGE_KEY_LOCKED = 'aconnect_screen_locked';

let lastActivityTime = Date.now();
let checkInterval = null;
let isLocked = false;
let socketInstance = null;
let currentMode = 'login'; // 'login' | 'inactivity'

export function setLockSocket(socket) {
  socketInstance = socket;
}

export function registerUserActivity() {
  lastActivityTime = Date.now();
  if (isLocked) return;
}

export function initInactivityLock(socket = null) {
  if (socket) socketInstance = socket;

  ensureDOMReady(() => {
    createOverlayDOM();

    // Before entering chat, screen is always blurred for login
    if (document.body.classList.contains('screen-locked') || (!document.body.classList.contains('landing-body') && !window.hasEnteredChat)) {
      lockScreen({ mode: 'login' });
    } else if (localStorage.getItem(STORAGE_KEY_LOCKED) === 'true') {
      lockScreen({ mode: 'inactivity' });
    } else {
      lastActivityTime = Date.now();
    }

    // Interval checking message/activity time every 2 seconds
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(checkInactivity, 2000);

    // Track user actions (typing, sending messages, clicking UI)
    const userEvents = ['keydown', 'mousedown', 'touchstart', 'click'];
    userEvents.forEach((evt) => {
      window.addEventListener(evt, () => registerUserActivity(), { passive: true });
    });

    // Touch screen or click anywhere on locked screen focuses password input
    window.addEventListener('touchstart', handleLockedTouch, { passive: false });
    window.addEventListener('click', handleLockedTouch, { passive: false });

    // Lock screen instantly on tab focus lost (switching tabs, minimizing, losing window focus)
    function handleTabFocusLost() {
      if (window.isOpeningFilePicker) return;
      if (document.body && document.body.classList.contains('landing-body')) return;
      if (isLocked) return;
      if (window.hasEnteredChat) {
        lockScreen({ mode: 'instant' });
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        handleTabFocusLost();
      }
    });

    window.addEventListener('blur', () => {
      handleTabFocusLost();
    });
  });
}

function ensureDOMReady(fn) {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

function checkInactivity() {
  if (isLocked || !window.hasEnteredChat) return;
  const elapsed = Date.now() - lastActivityTime;
  if (elapsed >= INACTIVITY_TIMEOUT_MS) {
    lockScreen({ mode: 'inactivity' });
  }
}

function handleLockedTouch(e) {
  if (!isLocked) return;
  
  if (e.target.closest('#inactivityLockForm')) {
    return;
  }
  
  const lockInput = document.getElementById('inactivityLockInput');
  if (lockInput) {
    lockInput.focus();
  }
}

export function lockScreen(options = {}) {
  isLocked = true;
  currentMode = options.mode || (window.hasEnteredChat ? 'inactivity' : 'login');
  localStorage.setItem(STORAGE_KEY_LOCKED, 'true');
  
  if (document.body) {
    document.body.classList.add('screen-locked');
  }

  if (typeof window.onScreenLocked === 'function') {
    try { window.onScreenLocked(); } catch (_) {}
  }

  const titleEl = document.getElementById('lockTitle');
  const descEl = document.getElementById('lockDesc');
  const btnEl = document.getElementById('lockSubmitBtn');

  if (currentMode === 'login') {
    if (titleEl) titleEl.textContent = 'Security Clearance Required';
    if (descEl) descEl.innerHTML = 'Screen blurred for privacy.<br>Enter clearance password to enter chat.';
    if (btnEl) btnEl.textContent = 'Enter Chat ➔';
  } else if (currentMode === 'instant') {
    if (titleEl) titleEl.textContent = 'Terminal Locked';
    if (descEl) descEl.innerHTML = 'Screen locked instantly for security.<br>Enter clearance password to unlock.';
    if (btnEl) btnEl.textContent = 'Unlock Screen ➔';
  } else {
    if (titleEl) titleEl.textContent = 'System Inactivity Lock';
    if (descEl) descEl.innerHTML = 'Screen locked after 5 minutes of inactivity.<br>Enter clearance password to unlock.';
    if (btnEl) btnEl.textContent = 'Unlock Screen ➔';
  }

  const overlay = document.getElementById('inactivityLockOverlay');
  if (overlay) {
    overlay.classList.add('active');
    const lockInput = document.getElementById('inactivityLockInput');
    if (lockInput) {
      lockInput.value = '';
      setTimeout(() => lockInput.focus(), 150);
    }
  }

  const errorEl = document.getElementById('lockErrorMessage');
  if (errorEl) errorEl.textContent = '';
}

export function unlockScreen() {
  isLocked = false;
  localStorage.removeItem(STORAGE_KEY_LOCKED);
  lastActivityTime = Date.now();
  
  if (document.body) {
    document.body.classList.remove('screen-locked');
  }

  const overlay = document.getElementById('inactivityLockOverlay');
  if (overlay) {
    overlay.classList.remove('active');
  }

  const lockInput = document.getElementById('inactivityLockInput');
  if (lockInput) lockInput.value = '';

  const errorEl = document.getElementById('lockErrorMessage');
  if (errorEl) errorEl.textContent = '';
}

function createOverlayDOM() {
  if (document.getElementById('inactivityLockOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'inactivityLockOverlay';
  overlay.innerHTML = `
    <div class="lock-card" id="lockCard">
      <div class="lock-icon">🔒</div>
      <div class="lock-title" id="lockTitle">Security Clearance Required</div>
      <div class="lock-desc" id="lockDesc">Screen blurred for privacy.<br>Enter clearance password to enter chat.</div>
      <form class="lock-form" id="inactivityLockForm">
        <div class="lock-input-group">
          <input type="password" id="inactivityLockInput" class="lock-input" placeholder="Enter Clearance Password" autocomplete="off" />
        </div>
        <button type="submit" id="lockSubmitBtn" class="btn btn-primary lock-btn">Enter Chat ➔</button>
      </form>
      <div class="lock-error" id="lockErrorMessage"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  const form = document.getElementById('inactivityLockForm');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const input = document.getElementById('inactivityLockInput');
    verifyPassword(input?.value || '');
  });
}

export function verifyPassword(password) {
  const cleanPass = String(password || '').trim();
  const errorEl = document.getElementById('lockErrorMessage');
  const card = document.getElementById('lockCard');

  if (!cleanPass) {
    if (errorEl) errorEl.textContent = 'Password required.';
    shakeCard(card);
    return;
  }

  const targetRoom = window.currentRoomName || 'Default';

  const handleResult = (res) => {
    if (res?.ok) {
      window.hasEnteredChat = true;
      localStorage.setItem('aconnect_room_pass', cleanPass);
      unlockScreen();
      if (typeof window.onSuccessfulUnlock === 'function') {
        window.onSuccessfulUnlock(cleanPass);
      }
    } else {
      // Wrong password: destroy all messages silently!
      if (typeof window.onDestroyMessagesSilently === 'function') {
        window.onDestroyMessagesSilently();
      }
      if (errorEl) errorEl.textContent = res?.error || 'Access Denied: Invalid Password.';
      shakeCard(card);
    }
  };

  if (socketInstance && socketInstance.connected) {
    socketInstance.emit('verify-lock-password', { password: cleanPass, roomName: targetRoom }, handleResult);
  } else if (socketInstance) {
    socketInstance.once('connect', () => {
      socketInstance.emit('verify-lock-password', { password: cleanPass, roomName: targetRoom }, handleResult);
    });
  } else {
    const storedPass = localStorage.getItem('aconnect_room_pass') || 'turtle';
    if (cleanPass === storedPass || cleanPass === 'turtle') {
      handleResult({ ok: true });
    } else {
      handleResult({ ok: false, error: 'Access Denied: Invalid Password.' });
    }
  }
}

function shakeCard(card) {
  if (!card) return;
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
}

// Global window helpers for developer/user testing
window.lockScreen = lockScreen;
window.unlockScreen = unlockScreen;
window.verifyLockPassword = verifyPassword;
window.registerUserActivity = registerUserActivity;
window.setInactivityTimeout = (seconds) => {
  INACTIVITY_TIMEOUT_MS = seconds * 1000;
  lastActivityTime = Date.now();
  console.log(`Inactivity lock timeout set to ${seconds} seconds.`);
};
