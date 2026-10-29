import { formatBytes } from './utils.js';
import { getDeviceInfo, sendDeviceHeartbeat } from './device-detector.js';

// Send initial device footprint when vault is visited
sendDeviceHeartbeat('Media Vault Visited');

const vaultAuthSection = document.getElementById('vaultAuthSection');
const galleryContentSection = document.getElementById('galleryContentSection');
const vaultAuthForm = document.getElementById('vaultAuthForm');
const vaultPasswordInput = document.getElementById('vaultPasswordInput');
const vaultAuthError = document.getElementById('vaultAuthError');
const vaultStatusBadge = document.getElementById('vaultStatusBadge');
const lockVaultBtn = document.getElementById('lockVaultBtn');
const refreshVaultBtn = document.getElementById('refreshVaultBtn');
const galleryGrid = document.getElementById('galleryGrid');
const emptyGalleryState = document.getElementById('emptyGalleryState');
const galleryTotalCount = document.getElementById('galleryTotalCount');
const galleryTotalSize = document.getElementById('galleryTotalSize');

// Lightbox Elements
const galleryLightbox = document.getElementById('galleryLightbox');
const lightboxFileName = document.getElementById('lightboxFileName');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxDownloadBtn = document.getElementById('lightboxDownloadBtn');
const lightboxCloseBtn = document.getElementById('lightboxCloseBtn');
const lightboxCloseBtn2 = document.getElementById('lightboxCloseBtn2');

let activePassword = '';
let currentImages = [];

async function authenticateAndLoad(password) {
  if (!password) {
    showError('Please enter the vault security password.');
    return;
  }

  hideError();
  const submitBtn = document.getElementById('vaultAuthSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Decrypting Vault...';
  }

  try {
    const deviceInfo = getDeviceInfo();
    const res = await fetch('/api/gallery/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, deviceInfo })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Access denied: Invalid key.');
    }

    activePassword = password;
    renderGallery(data.images || []);
    unlockUI();
  } catch (err) {
    showError(err.message || 'Access Denied: Invalid password.');
    if (vaultPasswordInput) {
      vaultPasswordInput.value = '';
      vaultPasswordInput.focus();
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '🔓 Decrypt Vault ➔';
    }
  }
}

function unlockUI() {
  vaultAuthSection.classList.add('hidden');
  galleryContentSection.classList.remove('hidden');
  vaultStatusBadge.textContent = '🟢 VAULT UNLOCKED';
  vaultStatusBadge.classList.add('unlocked');
  lockVaultBtn.classList.remove('hidden');
  refreshVaultBtn.classList.remove('hidden');
}

function lockUI() {
  activePassword = '';
  sessionStorage.removeItem('aconnect_gallery_auth');
  currentImages = [];
  vaultAuthSection.classList.remove('hidden');
  galleryContentSection.classList.add('hidden');
  vaultStatusBadge.textContent = '🔒 SECURE VAULT';
  vaultStatusBadge.classList.remove('unlocked');
  lockVaultBtn.classList.add('hidden');
  refreshVaultBtn.classList.add('hidden');
  galleryGrid.innerHTML = '';
  if (vaultPasswordInput) {
    vaultPasswordInput.value = '';
    vaultPasswordInput.focus();
  }
}

function showError(msg) {
  if (!vaultAuthError) return;
  vaultAuthError.textContent = msg;
  vaultAuthError.classList.remove('hidden');
}

function hideError() {
  if (!vaultAuthError) return;
  vaultAuthError.textContent = '';
  vaultAuthError.classList.add('hidden');
}

function renderGallery(images = []) {
  currentImages = images;
  galleryGrid.innerHTML = '';

  const totalFiles = images.length;
  const totalBytes = images.reduce((sum, item) => sum + (item.fileSize || 0), 0);

  if (galleryTotalCount) galleryTotalCount.textContent = String(totalFiles);
  if (galleryTotalSize) galleryTotalSize.textContent = formatBytes(totalBytes);

  if (totalFiles === 0) {
    emptyGalleryState.classList.remove('hidden');
    return;
  }
  emptyGalleryState.classList.add('hidden');

  images.forEach((img) => {
    const card = document.createElement('div');
    card.className = 'gallery-card';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'gallery-thumb-wrap';
    thumbWrap.title = 'Click to open preview';

    const imgTag = document.createElement('img');
    imgTag.src = img.thumbUrl || img.imageUrl;
    imgTag.alt = img.fileName || 'Archive image';
    imgTag.loading = 'lazy';
    thumbWrap.appendChild(imgTag);

    thumbWrap.addEventListener('click', () => openLightbox(img));

    const body = document.createElement('div');
    body.className = 'gallery-card-body';

    const title = document.createElement('div');
    title.className = 'gallery-card-title';
    title.textContent = img.fileName || 'image.jpg';
    title.title = img.fileName || 'image.jpg';

    const meta = document.createElement('div');
    meta.className = 'gallery-card-meta';
    const dateStr = img.timestamp ? new Date(img.timestamp).toLocaleDateString() : 'Recent';
    meta.innerHTML = `<span>${formatBytes(img.fileSize)}</span><span>${dateStr}</span>`;

    const dlBtn = document.createElement('a');
    dlBtn.className = 'gallery-download-btn';
    dlBtn.href = img.downloadUrl || img.imageUrl;
    dlBtn.download = img.fileName || 'image.jpg';
    dlBtn.textContent = '📥 Download';

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(dlBtn);

    card.appendChild(thumbWrap);
    card.appendChild(body);
    galleryGrid.appendChild(card);
  });
}

function openLightbox(img) {
  if (!galleryLightbox) return;
  lightboxFileName.textContent = `${img.fileName || 'image.jpg'} (${formatBytes(img.fileSize)})`;
  lightboxImage.src = img.imageUrl || img.thumbUrl;
  lightboxDownloadBtn.href = img.downloadUrl || img.imageUrl;
  lightboxDownloadBtn.download = img.fileName || 'image.jpg';
  lightboxDownloadBtn.textContent = `📥 Download Full Quality (${formatBytes(img.fileSize)})`;
  galleryLightbox.classList.remove('hidden');
}

function closeLightbox() {
  if (!galleryLightbox) return;
  galleryLightbox.classList.add('hidden');
  lightboxImage.src = '';
}

// Event Listeners
vaultAuthForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const password = vaultPasswordInput.value.trim();
  authenticateAndLoad(password);
});

lockVaultBtn.addEventListener('click', lockUI);

refreshVaultBtn.addEventListener('click', () => {
  if (activePassword) {
    authenticateAndLoad(activePassword);
  }
});

lightboxCloseBtn?.addEventListener('click', closeLightbox);
lightboxCloseBtn2?.addEventListener('click', closeLightbox);

galleryLightbox?.addEventListener('click', (e) => {
  if (e.target === galleryLightbox) {
    closeLightbox();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !galleryLightbox.classList.contains('hidden')) {
    closeLightbox();
  }
});

// Ensure password input is completely empty on load
if (vaultPasswordInput) {
  vaultPasswordInput.value = '';
  vaultPasswordInput.focus();
}
