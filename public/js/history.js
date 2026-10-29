import { escapeHtml } from './utils.js';

const historyAuthSection = document.getElementById('historyAuthSection');
const historyContentSection = document.getElementById('historyContentSection');
const historyAuthForm = document.getElementById('historyAuthForm');
const historyPasswordInput = document.getElementById('historyPasswordInput');
const historyAuthError = document.getElementById('historyAuthError');
const historyStatusBadge = document.getElementById('historyStatusBadge');
const lockHistoryBtn = document.getElementById('lockHistoryBtn');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');

const statTotalDevices = document.getElementById('statTotalDevices');
const statTotalLogins = document.getElementById('statTotalLogins');
const statActiveDevices = document.getElementById('statActiveDevices');
const statLastActivity = document.getElementById('statLastActivity');

const historySearchInput = document.getElementById('historySearchInput');
const deviceTypeFilter = document.getElementById('deviceTypeFilter');
const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');
const devicesList = document.getElementById('devicesList');
const emptyHistoryState = document.getElementById('emptyHistoryState');

let activePassword = '';
let currentDevices = [];
let collapsedDevices = new Set();

function formatRelativeTime(dateStr) {
  if (!dateStr) return '--';
  const time = new Date(dateStr).getTime();
  if (isNaN(time)) return '--';
  const diffSec = Math.floor((Date.now() - time) / 1000);
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatFullDateTime(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getDeviceIcon(type = '') {
  switch (String(type).toLowerCase()) {
    case 'mobile':
      return '📱';
    case 'tablet':
      return '📟';
    case 'desktop':
    default:
      return '💻';
  }
}

async function authenticateAndLoad(password) {
  if (!password) {
    showError('Please enter the security password.');
    return;
  }

  hideError();
  const submitBtn = document.getElementById('historyAuthSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Decrypting Audit Log...';
  }

  try {
    const res = await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Access denied: Invalid key.');
    }

    activePassword = password;
    currentDevices = data.devices || [];
    updateStats(data.stats);
    renderDevices();
    unlockUI();
  } catch (err) {
    showError(err.message || 'Access Denied: Invalid password.');
    if (historyPasswordInput) {
      historyPasswordInput.value = '';
      historyPasswordInput.focus();
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '🔓 Decrypt Device Audit ➔';
    }
  }
}

function unlockUI() {
  historyAuthSection.classList.add('hidden');
  historyContentSection.classList.remove('hidden');
  historyStatusBadge.textContent = '🟢 AUDIT DECRYPTED';
  historyStatusBadge.classList.add('unlocked');
  lockHistoryBtn.classList.remove('hidden');
  refreshHistoryBtn.classList.remove('hidden');
}

function lockUI() {
  activePassword = '';
  currentDevices = [];
  historyAuthSection.classList.remove('hidden');
  historyContentSection.classList.add('hidden');
  historyStatusBadge.textContent = '🔒 RESTRICTED AUDIT';
  historyStatusBadge.classList.remove('unlocked');
  lockHistoryBtn.classList.add('hidden');
  refreshHistoryBtn.classList.add('hidden');
  devicesList.innerHTML = '';
  if (historyPasswordInput) {
    historyPasswordInput.value = '';
    historyPasswordInput.focus();
  }
}

function showError(msg) {
  if (!historyAuthError) return;
  historyAuthError.textContent = msg;
  historyAuthError.classList.remove('hidden');
}

function hideError() {
  if (!historyAuthError) return;
  historyAuthError.textContent = '';
  historyAuthError.classList.add('hidden');
}

function updateStats(stats = {}) {
  if (statTotalDevices) statTotalDevices.textContent = stats.totalDevices ?? currentDevices.length;
  if (statTotalLogins) statTotalLogins.textContent = stats.totalLogins ?? 0;
  if (statActiveDevices) statActiveDevices.textContent = stats.activeDevices ?? 0;
  if (statLastActivity) statLastActivity.textContent = formatRelativeTime(stats.lastLogin);
}

function renderDevices() {
  if (!devicesList) return;
  devicesList.innerHTML = '';

  const q = String(historySearchInput?.value || '').trim().toLowerCase();
  const filterType = deviceTypeFilter?.value || 'all';

  const filtered = currentDevices.filter((dev) => {
    // Type filter
    if (filterType === 'online' && !dev.isOnline) return false;
    if (filterType === 'mobile' && dev.deviceType !== 'mobile') return false;
    if (filterType === 'desktop' && dev.deviceType !== 'desktop') return false;
    if (filterType === 'tablet' && dev.deviceType !== 'tablet') return false;

    // Search query filter
    if (!q) return true;
    const haystacks = [
      dev.deviceName,
      dev.deviceModel,
      dev.os,
      dev.browser,
      dev.lastIp,
      dev.deviceId,
      ...(dev.logins || []).map((l) => `${l.action} ${l.ip} ${l.username || ''} ${l.room || ''}`)
    ].join(' ').toLowerCase();

    return haystacks.includes(q);
  });

  if (filtered.length === 0) {
    emptyHistoryState?.classList.remove('hidden');
    return;
  }

  emptyHistoryState?.classList.add('hidden');

  filtered.forEach((dev) => {
    const isCollapsed = collapsedDevices.has(dev.deviceId);
    const card = document.createElement('div');
    card.className = `device-card ${dev.isOnline ? 'is-online' : ''} ${isCollapsed ? 'collapsed' : ''}`;
    card.dataset.deviceId = dev.deviceId;

    const logins = Array.isArray(dev.logins) ? dev.logins : [];
    const icon = getDeviceIcon(dev.deviceType);

    card.innerHTML = `
      <div class="device-card-header" data-toggle="true">
        <div class="device-info-main">
          <div class="device-icon-badge">${icon}</div>
          <div class="device-text-group">
            <div class="device-header-top">
              <span class="device-name">${escapeHtml(dev.deviceName || dev.deviceModel || 'Terminal Device')}</span>
              <span class="status-pill ${dev.isOnline ? 'online' : 'offline'}">
                <span class="pulse-dot"></span>
                ${dev.isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <div class="device-chips">
              <span class="meta-chip">OS: <strong>${escapeHtml(dev.os || 'Unknown')}</strong></span>
              <span class="meta-chip">Browser: <strong>${escapeHtml(dev.browser || 'Unknown')}</strong></span>
              ${dev.screen && dev.screen !== 'N/A' ? `<span class="meta-chip">Screen: ${escapeHtml(dev.screen)}</span>` : ''}
              ${dev.timezone && dev.timezone !== 'UTC' ? `<span class="meta-chip">${escapeHtml(dev.timezone)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="device-header-actions">
          <span class="session-counter-badge">${logins.length} ${logins.length === 1 ? 'Session' : 'Sessions'}</span>
          <button class="btn-card-delete" data-action="delete-device" title="Remove device from log">🗑️</button>
          <span class="accordion-chevron">▼</span>
        </div>
      </div>

      <div class="device-card-body">
        <div class="device-meta-bar">
          <div class="meta-bar-item">
            <span class="item-label">DEVICE IDENTIFIER</span>
            <span class="item-value" title="${escapeHtml(dev.deviceId)}">${escapeHtml(dev.deviceId)}</span>
          </div>
          <div class="meta-bar-item">
            <span class="item-label">FIRST DETECTED</span>
            <span class="item-value">${formatFullDateTime(dev.firstSeen)}</span>
          </div>
          <div class="meta-bar-item">
            <span class="item-label">LATEST SEEN</span>
            <span class="item-value">${formatRelativeTime(dev.lastSeen)} (${formatFullDateTime(dev.lastSeen)})</span>
          </div>
          <div class="meta-bar-item">
            <span class="item-label">LAST CLIENT IP</span>
            <span class="item-value">${escapeHtml(dev.lastIp || 'Unknown IP')}</span>
          </div>
        </div>

        <div class="session-section-title">
          <span>Authentication & Session History</span>
          <span>${logins.length} recorded events</span>
        </div>

        <div class="session-timeline">
          ${logins.map((item) => {
            let pillClass = '';
            const act = item.action || 'Login';
            if (act.toLowerCase().includes('unlock')) pillClass = 'unlock';
            else if (act.toLowerCase().includes('room')) pillClass = 'room';

            return `
              <div class="session-row">
                <div class="session-action-group">
                  <span class="action-pill ${pillClass}">${escapeHtml(act)}</span>
                  ${item.username ? `<span style="color: var(--text-secondary);">by <strong style="color: var(--text-primary);">${escapeHtml(item.username)}</strong></span>` : ''}
                  ${item.room ? `<span style="color: var(--text-secondary);">in [${escapeHtml(item.room)}]</span>` : ''}
                </div>
                <div class="session-time-group">
                  <span class="session-ip-badge">${escapeHtml(item.ip || 'Unknown IP')}</span>
                  <span title="${formatFullDateTime(item.timestamp)}">${formatRelativeTime(item.timestamp)}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Event listeners on card
    const header = card.querySelector('.device-card-header');
    header.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="delete-device"]')) {
        e.stopPropagation();
        deleteDevice(dev.deviceId);
        return;
      }
      toggleCardCollapse(dev.deviceId, card);
    });

    devicesList.appendChild(card);
  });
}

function toggleCardCollapse(deviceId, card) {
  if (collapsedDevices.has(deviceId)) {
    collapsedDevices.delete(deviceId);
    card.classList.remove('collapsed');
  } else {
    collapsedDevices.add(deviceId);
    card.classList.add('collapsed');
  }
}

async function deleteDevice(deviceId) {
  if (!confirm('Remove this device and its session history from audit logs?')) {
    return;
  }

  try {
    const res = await fetch('/api/history/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: activePassword, deviceId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      alert(data.error || 'Failed to remove device record.');
      return;
    }

    currentDevices = currentDevices.filter((d) => d.deviceId !== deviceId);
    renderDevices();
  } catch (err) {
    alert(err.message || 'Error deleting device.');
  }
}

async function clearAllHistory() {
  if (!confirm('⚠️ Are you sure you want to PURGE ALL login and device history? This cannot be undone.')) {
    return;
  }

  try {
    const res = await fetch('/api/history/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: activePassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      alert(data.error || 'Failed to clear history.');
      return;
    }

    currentDevices = [];
    updateStats({ totalDevices: 0, totalLogins: 0, activeDevices: 0, lastLogin: null });
    renderDevices();
  } catch (err) {
    alert(err.message || 'Error clearing history.');
  }
}

async function refreshHistory() {
  if (!activePassword) return;
  await authenticateAndLoad(activePassword);
}

// Event Listeners
historyAuthForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const pass = String(historyPasswordInput?.value || '').trim();
  authenticateAndLoad(pass);
});

lockHistoryBtn?.addEventListener('click', () => {
  lockUI();
});

refreshHistoryBtn?.addEventListener('click', () => {
  refreshHistory();
});

historySearchInput?.addEventListener('input', () => {
  renderDevices();
});

deviceTypeFilter?.addEventListener('change', () => {
  renderDevices();
});

clearAllHistoryBtn?.addEventListener('click', () => {
  clearAllHistory();
});

// Auto-check session if passed via window or simply keep empty
window.addEventListener('DOMContentLoaded', () => {
  if (historyPasswordInput) {
    historyPasswordInput.value = '';
    historyPasswordInput.focus();
  }
});
