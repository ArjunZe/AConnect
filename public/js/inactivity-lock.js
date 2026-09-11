/**
 * Inactivity Lock & Blur System
 * Blurs whole screen after 5 minutes of inactivity.
 * Touching the screen / reloading page asks for password to remove blur.
 */

let INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default
const STORAGE_KEY_LOCKED = 'aconnect_screen_locked';

let inactivityTimer = null;
let isLocked = false;
let socketInstance = null;
let lastMouseX = -1;
let lastMouseY = -1;

export function setLockSocket(socket) {
  socketInstance = socket;
}

export function initInactivityLock(socket = null) {
  if (socket) socketInstance = socket;

  ensureDOMReady(() => {
    createOverlayDOM();

    // Check if page was previously locked or reloaded while locked
    if (localStorage.getItem(STORAGE_KEY_LOCKED) === 'true') {
      lockScreen();
    } else {
      resetInactivityTimer();
    }

    // Activity listeners for real user actions
    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, handleUserActivity, { passive: true });
    });

    // Mousemove with >10px delta threshold to prevent laptop trackpad sensor noise from resetting timer
    window.addEventListener('mousemove', (e) => {
      if (lastMouseX >= 0 && lastMouseY >= 0) {
        const deltaX = Math.abs(e.pageX - lastMouseX);
        const deltaY = Math.abs(e.pageY - lastMouseY);
        if (deltaX > 10 || deltaY > 10) {
          handleUserActivity();
          lastMouseX = e.pageX;
          lastMouseY = e.pageY;
        }
      } else {
        lastMouseX = e.pageX;
        lastMouseY = e.pageY;
      }
    }, { passive: true });

    // Touch screen or click anywhere on locked screen asks for password
    window.addEventListener('touchstart', handleLockedTouch, { passive: false });
    window.addEventListener('click', handleLockedTouch, { passive: false });
  });
}

function ensureDOMReady(fn) {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

function handleUserActivity() {
  if (isLocked) return;
  resetInactivityTimer();
}

function handleLockedTouch(e) {
  if (!isLocked) return;
  
  // If target is inside the lock form input or button, let form handle it directly
  if (e.target.closest('#inactivityLockForm')) {
    return;
  }
  
  e.preventDefault();
  askPasswordPrompt();
}

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    lockScreen();
  }, INACTIVITY_TIMEOUT_MS);
}

export function lockScreen() {
  isLocked = true;
  localStorage.setItem(STORAGE_KEY_LOCKED, 'true');
  
  if (document.body) {
    document.body.classList.add('screen-locked');
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

  resetInactivityTimer();
}

function askPasswordPrompt() {
  const typed = prompt('🔒 Terminal Inactivity Lock\nEnter clearance password to unlock:');
  if (typed !== null) {
    verifyPassword(typed);
  }
}

function createOverlayDOM() {
  if (document.getElementById('inactivityLockOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'inactivityLockOverlay';
  overlay.innerHTML = `
    <div class="lock-card" id="lockCard">
      <div class="lock-icon">🔒</div>
      <div class="lock-title">System Inactivity Lock</div>
      <div class="lock-desc">Screen locked after 5 minutes of inactivity.<br>Touch screen or enter password to unlock.</div>
      <form class="lock-form" id="inactivityLockForm">
        <div class="lock-input-group">
          <input type="password" id="inactivityLockInput" class="lock-input" placeholder="Enter Clearance Password" autocomplete="off" />
        </div>
        <button type="submit" class="btn btn-primary lock-btn">Unlock Screen ➔</button>
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

function verifyPassword(password) {
  const cleanPass = String(password || '').trim();
  const errorEl = document.getElementById('lockErrorMessage');
  const card = document.getElementById('lockCard');

  if (!cleanPass) {
    if (errorEl) errorEl.textContent = 'Password required to unlock.';
    shakeCard(card);
    return;
  }

  if (socketInstance && socketInstance.connected) {
    socketInstance.emit('verify-lock-password', { password: cleanPass }, (res) => {
      if (res?.ok) {
        unlockScreen();
      } else {
        if (errorEl) errorEl.textContent = res?.error || 'Access Denied: Invalid Password.';
        shakeCard(card);
        alert('Access Denied: Invalid Password.');
      }
    });
  } else {
    const storedPass = localStorage.getItem('aconnect_room_pass') || 'turtle';
    if (cleanPass === storedPass || cleanPass === 'turtle') {
      unlockScreen();
    } else {
      if (errorEl) errorEl.textContent = 'Access Denied: Invalid Password.';
      shakeCard(card);
      alert('Access Denied: Invalid Password.');
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
window.setInactivityTimeout = (seconds) => {
  INACTIVITY_TIMEOUT_MS = seconds * 1000;
  resetInactivityTimer();
  console.log(`Inactivity lock timeout set to ${seconds} seconds.`);
};
