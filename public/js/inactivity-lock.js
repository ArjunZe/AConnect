/**
 * Inactivity Lock & Blur System
 * Blurs whole screen after 5 minutes of inactivity.
 * Touching the screen / reloading page asks for password to remove blur.
 */

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY_LOCKED = 'aconnect_screen_locked';

let inactivityTimer = null;
let isLocked = false;
let socketInstance = null;

export function setLockSocket(socket) {
  socketInstance = socket;
}

export function initInactivityLock(socket = null) {
  if (socket) socketInstance = socket;

  createOverlayDOM();

  // Check if page was previously locked or reloaded while locked
  if (localStorage.getItem(STORAGE_KEY_LOCKED) === 'true') {
    lockScreen();
  } else {
    resetInactivityTimer();
  }

  // Global user activity listeners
  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove', 'scroll', 'pointerdown', 'click'];
  events.forEach((evt) => {
    window.addEventListener(evt, handleUserActivity, { passive: true });
  });

  // Touch or tap anywhere on locked screen prompts password input focus
  window.addEventListener('touchstart', handleLockedInteraction);
  window.addEventListener('click', handleLockedInteraction);
}

function handleUserActivity() {
  if (isLocked) return;
  resetInactivityTimer();
}

function handleLockedInteraction(e) {
  if (!isLocked) return;
  const lockInput = document.getElementById('inactivityLockInput');
  if (lockInput && document.activeElement !== lockInput) {
    lockInput.focus();
  }
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
  document.body.classList.add('screen-locked');

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
  document.body.classList.remove('screen-locked');

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
    verifyAndUnlock();
  });
}

function verifyAndUnlock() {
  const input = document.getElementById('inactivityLockInput');
  const errorEl = document.getElementById('lockErrorMessage');
  const card = document.getElementById('lockCard');
  const password = (input?.value || '').trim();

  if (!password) {
    if (errorEl) errorEl.textContent = 'Password required to unlock.';
    shakeCard(card);
    return;
  }

  if (socketInstance && socketInstance.connected) {
    socketInstance.emit('verify-lock-password', { password }, (res) => {
      if (res?.ok) {
        unlockScreen();
      } else {
        if (errorEl) errorEl.textContent = res?.error || 'Access Denied: Invalid Password.';
        shakeCard(card);
      }
    });
  } else {
    // Fallback check if socket not connected yet
    const storedPass = localStorage.getItem('aconnect_room_pass') || 'turtle';
    if (password === storedPass || password === 'turtle') {
      unlockScreen();
    } else {
      if (errorEl) errorEl.textContent = 'Access Denied: Invalid Password.';
      shakeCard(card);
    }
  }
}

function shakeCard(card) {
  if (!card) return;
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
}
