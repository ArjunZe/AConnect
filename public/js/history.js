import { escapeHtml } from './utils.js';

function safeEscape(str) {
  if (typeof escapeHtml === 'function') return escapeHtml(str);
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

// DOM Elements
const historyAuthSection = document.getElementById('historyAuthSection');
const historyContentSection = document.getElementById('historyContentSection');
const historyAuthForm = document.getElementById('historyAuthForm');
const historyPasswordInput = document.getElementById('historyPasswordInput');
const historyAuthError = document.getElementById('historyAuthError');
const historyStatusBadge = document.getElementById('historyStatusBadge');
const lockHistoryBtn = document.getElementById('lockHistoryBtn');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');

// Stats Elements
const statTotalDevices = document.getElementById('statTotalDevices');
const statTotalLogins = document.getElementById('statTotalLogins');
const statActiveDevices = document.getElementById('statActiveDevices');
const statLastActivity = document.getElementById('statLastActivity');

const statMobileDevices = document.getElementById('statMobileDevices');
const statDesktopDevices = document.getElementById('statDesktopDevices');
const statTabletDevices = document.getElementById('statTabletDevices');
const statUniqueIps = document.getElementById('statUniqueIps');

const pillFilterMobile = document.getElementById('pillFilterMobile');
const pillFilterDesktop = document.getElementById('pillFilterDesktop');
const pillFilterTablet = document.getElementById('pillFilterTablet');

// Filter & Control Elements
const historySearchInput = document.getElementById('historySearchInput');
const osFilter = document.getElementById('osFilter');
const ipFilter = document.getElementById('ipFilter');
const tzFilter = document.getElementById('tzFilter');
const deviceTypeFilter = document.getElementById('deviceTypeFilter');
const resetFiltersBtn = document.getElementById('resetFiltersBtn');
const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');

// Table & Empty State
const devicesTableBody = document.getElementById('devicesTableBody');
const emptyHistoryState = document.getElementById('emptyHistoryState');

// State
let activePassword = '';
let currentDevices = [];
let expandedDevices = new Set();

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
    populateFilterOptions();
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
  expandedDevices.clear();
  historyAuthSection.classList.remove('hidden');
  historyContentSection.classList.add('hidden');
  historyStatusBadge.textContent = '🔒 RESTRICTED AUDIT';
  historyStatusBadge.classList.remove('unlocked');
  lockHistoryBtn.classList.add('hidden');
  refreshHistoryBtn.classList.add('hidden');
  if (devicesTableBody) devicesTableBody.innerHTML = '';
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
  const total = stats.totalDevices ?? currentDevices.length;
  const logins = stats.totalLogins ?? currentDevices.reduce((sum, d) => sum + (Array.isArray(d.logins) ? d.logins.length : 0), 0);
  const online = stats.activeDevices ?? currentDevices.filter(d => d.isOnline).length;
  const last = stats.lastLogin ?? (currentDevices[0]?.lastSeen || null);

  if (statTotalDevices) statTotalDevices.textContent = total;
  if (statTotalLogins) statTotalLogins.textContent = logins;
  if (statActiveDevices) statActiveDevices.textContent = online;
  if (statLastActivity) statLastActivity.textContent = formatRelativeTime(last);

  // Secondary counts
  const mobileCount = currentDevices.filter(d => d.deviceType === 'mobile').length;
  const desktopCount = currentDevices.filter(d => d.deviceType === 'desktop').length;
  const tabletCount = currentDevices.filter(d => d.deviceType === 'tablet').length;
  const uniqueIps = new Set(currentDevices.map(d => d.lastIp).filter(Boolean)).size;

  if (statMobileDevices) statMobileDevices.textContent = mobileCount;
  if (statDesktopDevices) statDesktopDevices.textContent = desktopCount;
  if (statTabletDevices) statTabletDevices.textContent = tabletCount;
  if (statUniqueIps) statUniqueIps.textContent = uniqueIps;
}

function populateFilterOptions() {
  const prevOS = osFilter?.value || 'all';
  const prevIP = ipFilter?.value || 'all';
  const prevTZ = tzFilter?.value || 'all';

  // 1. Populate OS Filter
  if (osFilter) {
    const uniqueOS = Array.from(new Set(currentDevices.map(d => d.os).filter(Boolean))).sort();
    osFilter.innerHTML = `<option value="all">All OS (${uniqueOS.length})</option>` +
      uniqueOS.map(os => `<option value="${safeEscape(os)}">${safeEscape(os)}</option>`).join('');
    if (uniqueOS.includes(prevOS)) osFilter.value = prevOS;
  }

  // 2. Populate IP Filter
  if (ipFilter) {
    const allIps = currentDevices.flatMap(d => [d.lastIp, ...(d.logins || []).map(l => l.ip)]).filter(Boolean);
    const uniqueIP = Array.from(new Set(allIps)).sort();
    ipFilter.innerHTML = `<option value="all">All IPs (${uniqueIP.length})</option>` +
      uniqueIP.map(ip => `<option value="${safeEscape(ip)}">${safeEscape(ip)}</option>`).join('');
    if (uniqueIP.includes(prevIP)) ipFilter.value = prevIP;
  }

  // 3. Populate TZ Filter
  if (tzFilter) {
    const uniqueTZ = Array.from(new Set(currentDevices.map(d => d.timezone).filter(Boolean))).sort();
    tzFilter.innerHTML = `<option value="all">All TZ (${uniqueTZ.length})</option>` +
      uniqueTZ.map(tz => `<option value="${safeEscape(tz)}">${safeEscape(tz)}</option>`).join('');
    if (uniqueTZ.includes(prevTZ)) tzFilter.value = prevTZ;
  }
}

function renderDevices() {
  if (!devicesTableBody) return;
  devicesTableBody.innerHTML = '';

  const q = String(historySearchInput?.value || '').trim().toLowerCase();
  const selOS = osFilter?.value || 'all';
  const selIP = ipFilter?.value || 'all';
  const selTZ = tzFilter?.value || 'all';
  const selType = deviceTypeFilter?.value || 'all';

  // Update quick filter pill active states
  pillFilterMobile?.classList.toggle('active-filter', selType === 'mobile');
  pillFilterDesktop?.classList.toggle('active-filter', selType === 'desktop');
  pillFilterTablet?.classList.toggle('active-filter', selType === 'tablet');

  const filtered = currentDevices.filter((dev) => {
    // OS Filter
    if (selOS !== 'all' && dev.os !== selOS) return false;

    // IP Filter (checks last IP and session event IPs)
    if (selIP !== 'all') {
      const hasIp = dev.lastIp === selIP || (dev.logins || []).some(l => l.ip === selIP);
      if (!hasIp) return false;
    }

    // TZ Filter
    if (selTZ !== 'all' && dev.timezone !== selTZ) return false;

    // Status / Type Filter
    if (selType === 'online' && !dev.isOnline) return false;
    if (selType === 'offline' && dev.isOnline) return false;
    if (selType === 'mobile' && dev.deviceType !== 'mobile') return false;
    if (selType === 'desktop' && dev.deviceType !== 'desktop') return false;
    if (selType === 'tablet' && dev.deviceType !== 'tablet') return false;

    // Search query
    if (!q) return true;
    const haystacks = [
      dev.deviceName,
      dev.deviceModel,
      dev.os,
      dev.browser,
      dev.lastIp,
      dev.timezone,
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
    const isExpanded = expandedDevices.has(dev.deviceId);
    const logins = Array.isArray(dev.logins) ? dev.logins : [];
    const icon = getDeviceIcon(dev.deviceType);

    // 1. Main Device Row
    const mainRow = document.createElement('tr');
    mainRow.className = `device-row ${dev.isOnline ? 'is-online' : ''} ${isExpanded ? 'expanded' : ''}`;
    mainRow.dataset.deviceId = dev.deviceId;

    mainRow.innerHTML = `
      <td>
        <span class="status-pill ${dev.isOnline ? 'online' : 'offline'}">
          <span class="pulse-dot"></span>
          ${dev.isOnline ? 'Online' : 'Offline'}
        </span>
      </td>
      <td>
        <div class="device-cell-main">
          <span class="device-table-icon">${icon}</span>
          <div class="device-table-meta">
            <span class="device-table-name">${safeEscape(dev.deviceName || dev.deviceModel || 'Terminal Device')}</span>
            <span class="device-table-id" title="${safeEscape(dev.deviceId)}">${safeEscape(dev.deviceId)}</span>
          </div>
        </div>
      </td>
      <td><span class="meta-chip meta-chip-os">${safeEscape(dev.os || 'Unknown')}</span></td>
      <td><span class="meta-chip meta-chip-browser">${safeEscape(dev.browser || 'Unknown')}</span></td>
      <td><span class="session-ip-badge">${safeEscape(dev.lastIp || 'Unknown IP')}</span></td>
      <td><span class="meta-chip meta-chip-tz">${safeEscape(dev.timezone || 'UTC')}</span></td>
      <td style="text-align: center;">
        <button type="button" class="session-badge-toggle" data-action="toggle-sessions" title="Toggle session audit details">
          ${logins.length} ${logins.length === 1 ? 'event' : 'events'} <span class="badge-chevron">▼</span>
        </button>
      </td>
      <td>
        <span class="table-last-seen" title="${formatFullDateTime(dev.lastSeen)}">${formatRelativeTime(dev.lastSeen)}</span>
      </td>
      <td style="text-align: center;">
        <div class="table-action-btns">
          <button type="button" class="btn-table-action" data-action="toggle-sessions" title="View detailed session timeline">📜</button>
          <button type="button" class="btn-table-action btn-table-delete" data-action="delete-device" title="Remove device from log">🗑️</button>
        </div>
      </td>
    `;

    // 2. Expandable Details Sub-Row
    const detailRow = document.createElement('tr');
    detailRow.className = `device-details-row ${isExpanded ? '' : 'collapsed'}`;
    detailRow.dataset.detailsId = dev.deviceId;

    detailRow.innerHTML = `
      <td colspan="9" class="device-details-cell">
        <div class="details-accordion-inner">
          <div class="details-meta-summary">
            <div><strong>Device ID:</strong> <code>${safeEscape(dev.deviceId)}</code></div>
            <div><strong>First Detected:</strong> ${formatFullDateTime(dev.firstSeen)}</div>
            <div><strong>Latest Seen:</strong> ${formatFullDateTime(dev.lastSeen)}</div>
            <div><strong>Screen:</strong> ${safeEscape(dev.screen || 'N/A')}</div>
            <div><strong>Language:</strong> ${safeEscape(dev.language || 'en')}</div>
          </div>

          <div class="session-section-title">
            <span>Recorded Login & Room Events (${logins.length})</span>
          </div>

          <div class="session-timeline">
            ${logins.length === 0 ? '<div style="color: var(--text-secondary); font-size: 12px; padding: 4px;">No discrete session events recorded for this device.</div>' : ''}
            ${logins.map((item) => {
              let pillClass = '';
              const act = item.action || 'Login';
              if (act.toLowerCase().includes('unlock')) pillClass = 'unlock';
              else if (act.toLowerCase().includes('room')) pillClass = 'room';

              return `
                <div class="session-row">
                  <div class="session-action-group">
                    <span class="action-pill ${pillClass}">${safeEscape(act)}</span>
                    ${item.username ? `<span style="color: var(--text-secondary);">by <strong style="color: var(--text-primary);">${safeEscape(item.username)}</strong></span>` : ''}
                    ${item.room ? `<span style="color: var(--text-secondary);">in [${safeEscape(item.room)}]</span>` : ''}
                  </div>
                  <div class="session-time-group">
                    <span class="session-ip-badge">${safeEscape(item.ip || 'Unknown IP')}</span>
                    <span title="${formatFullDateTime(item.timestamp)}">${formatRelativeTime(item.timestamp)}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </td>
    `;

    // Row Event Handlers
    mainRow.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="delete-device"]')) {
        e.stopPropagation();
        deleteDevice(dev.deviceId);
        return;
      }
      toggleDeviceExpand(dev.deviceId, mainRow, detailRow);
    });

    devicesTableBody.appendChild(mainRow);
    devicesTableBody.appendChild(detailRow);
  });
}

function toggleDeviceExpand(deviceId, mainRow, detailRow) {
  if (expandedDevices.has(deviceId)) {
    expandedDevices.delete(deviceId);
    mainRow.classList.remove('expanded');
    detailRow.classList.add('collapsed');
  } else {
    expandedDevices.add(deviceId);
    mainRow.classList.add('expanded');
    detailRow.classList.remove('collapsed');
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
    expandedDevices.delete(deviceId);
    updateStats();
    populateFilterOptions();
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
    expandedDevices.clear();
    updateStats({ totalDevices: 0, totalLogins: 0, activeDevices: 0, lastLogin: null });
    populateFilterOptions();
    renderDevices();
  } catch (err) {
    alert(err.message || 'Error clearing history.');
  }
}

async function refreshHistory() {
  if (!activePassword) return;
  await authenticateAndLoad(activePassword);
}

function handleAuthSubmit(e) {
  if (e) e.preventDefault();
  const pass = String(historyPasswordInput?.value || '').trim();
  authenticateAndLoad(pass);
}

function resetAllFilters() {
  if (historySearchInput) historySearchInput.value = '';
  if (osFilter) osFilter.value = 'all';
  if (ipFilter) ipFilter.value = 'all';
  if (tzFilter) tzFilter.value = 'all';
  if (deviceTypeFilter) deviceTypeFilter.value = 'all';
  renderDevices();
}

// Quick-filter pill triggers
pillFilterMobile?.addEventListener('click', () => {
  if (deviceTypeFilter) {
    deviceTypeFilter.value = deviceTypeFilter.value === 'mobile' ? 'all' : 'mobile';
    renderDevices();
  }
});

pillFilterDesktop?.addEventListener('click', () => {
  if (deviceTypeFilter) {
    deviceTypeFilter.value = deviceTypeFilter.value === 'desktop' ? 'all' : 'desktop';
    renderDevices();
  }
});

pillFilterTablet?.addEventListener('click', () => {
  if (deviceTypeFilter) {
    deviceTypeFilter.value = deviceTypeFilter.value === 'tablet' ? 'all' : 'tablet';
    renderDevices();
  }
});

// Event Listeners
historyAuthForm?.addEventListener('submit', handleAuthSubmit);

const historyAuthSubmitBtn = document.getElementById('historyAuthSubmitBtn');
historyAuthSubmitBtn?.addEventListener('click', handleAuthSubmit);

historyPasswordInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleAuthSubmit(e);
  }
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

osFilter?.addEventListener('change', () => {
  renderDevices();
});

ipFilter?.addEventListener('change', () => {
  renderDevices();
});

tzFilter?.addEventListener('change', () => {
  renderDevices();
});

deviceTypeFilter?.addEventListener('change', () => {
  renderDevices();
});

resetFiltersBtn?.addEventListener('click', () => {
  resetAllFilters();
});

clearAllHistoryBtn?.addEventListener('click', () => {
  clearAllHistory();
});

// Focus password input immediately and ensure it starts empty
if (historyPasswordInput) {
  historyPasswordInput.value = '';
  historyPasswordInput.focus();
}
window.addEventListener('DOMContentLoaded', () => {
  if (historyPasswordInput) {
    historyPasswordInput.value = '';
    historyPasswordInput.focus();
  }
});
