import { createSocket } from './socket-client.js';
import { debounce, generateUsername, sanitizeMessage, showNotification } from './utils.js';
import { SciFiCloudEngine, getUserColor } from './sci-fi-cloud.js';
import { initInactivityLock } from './inactivity-lock.js';
import {
  getVideoOnlyStream,
  createPeerConnection,
  createOffer,
  handleOffer,
  handleAnswer,
  handleIceCandidate
} from './webrtc.js';

const socket = createSocket('/chat');
initInactivityLock(socket);

// UI Elements
const usernameDisplay = document.getElementById('usernameDisplay');
const onlineCountEl = document.getElementById('onlineCount');
const roomListEl = document.getElementById('roomList');
const currentRoomNameEl = document.getElementById('currentRoomName');
const currentRoomCountEl = document.getElementById('currentRoomCount');
const roomTTLSelectHeader = document.getElementById('roomTTLSelectHeader');
const typingIndicator = document.getElementById('typingIndicator');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const roomUsersEl = document.getElementById('roomUsers');
const roomModal = document.getElementById('roomModal');
const roomNameInput = document.getElementById('roomNameInput');
const roomPasswordInput = document.getElementById('roomPasswordInput');
const roomTTLSelect = document.getElementById('roomTTLSelect');
const emojiPanel = document.getElementById('emojiPanel');
const fileInput = document.getElementById('fileInput');

// Live Video Elements
const liveVideoBtn = document.getElementById('liveVideoBtn');
const leftLiveVideoBtn = document.getElementById('leftLiveVideoBtn');
const dockVideoBtn = document.getElementById('dockVideoBtn');
const liveVideoHUD = document.getElementById('liveVideoHUD');
const opponentVideo = document.getElementById('opponentVideo');
const opponentVideoPlaceholder = document.getElementById('opponentVideoPlaceholder');
const localVideoPreview = document.getElementById('localVideoPreview');
const localPipWrap = document.getElementById('localPipWrap');
const videoStatusText = document.getElementById('videoStatusText');
const minimizeVideoBtn = document.getElementById('minimizeVideoBtn');
const closeVideoBtn = document.getElementById('closeVideoBtn');
const toggleSelfCamBtn = document.getElementById('toggleSelfCamBtn');
const stopVideoFeedBtn = document.getElementById('stopVideoFeedBtn');

// Mobile drawer buttons
const leftSidebarToggle = document.getElementById('leftSidebarToggle');
const rightSidebarToggle = document.getElementById('rightSidebarToggle');
const sidebarLeft = document.getElementById('sidebarLeft');
const sidebarRight = document.getElementById('sidebarRight');

const emojis = ['😀', '😂', '😍', '😎', '🤖', '🔥', '🎉', '✨', '🙌', '🚀', '💡', '⚡', '👏', '🥳', '🤔', '😇', '🛸', '🌌'];

let currentRoom = 'Default';
window.currentRoomName = currentRoom;
let currentMessageTTL = 24 * 60 * 60 * 1000; // 1 day default group timer (86,400,000 ms)
let mySocketId = '';
let myUsername = localStorage.getItem('anon_username') || generateUsername();
let pendingPasswords = new Map();

localStorage.setItem('anon_username', myUsername);
if (usernameDisplay) usernameDisplay.textContent = myUsername;

// Initialize True Canvas Sci-Fi Word Cloud Engine
const cloudEngine = new SciFiCloudEngine('wordCloudCanvas', 'sciFiBgCanvas');

// Reaction callback handler from inspect card
cloudEngine.onReactionClick = (messageId, emoji) => {
  socket.emit('add-reaction', { messageId, emoji });
};

// Hook up silent message destruction for wrong password attempts
window.onDestroyMessagesSilently = () => {
  cloudEngine.clear();
  if (isLiveVideoActive) {
    stopLiveVideo(true);
  }
};

window.onScreenLocked = () => {
  if (isLiveVideoActive) {
    stopLiveVideo(true);
  }
};

// Hook up login unlock completion
window.onSuccessfulUnlock = (pass) => {
  window.hasEnteredChat = true;
  joinRoom(currentRoom || 'Default', false, pass);
};

function formatTTLText(ttl) {
  if (!ttl || ttl <= 0) return 'Persistent (Off)';
  if (ttl >= 86400000) return `${Math.round(ttl / 86400000)} Day(s)`;
  if (ttl >= 3600000) return `${Math.round(ttl / 3600000)} Hour(s)`;
  return `${Math.round(ttl / 60000)} Minute(s)`;
}

// Editable Expiry Timer in Room HUD Header
if (roomTTLSelectHeader) {
  roomTTLSelectHeader.addEventListener('change', () => {
    const newTTL = Number(roomTTLSelectHeader.value);
    socket.emit('update-room-ttl', { room: currentRoom, messageTTL: newTTL }, (res) => {
      if (res?.ok) {
        currentMessageTTL = newTTL;
        cloudEngine.messageTTL = newTTL;
        showNotification('⚡ Timer Saved', `Disappearing timer set to ${formatTTLText(newTTL)} for ${currentRoom}`);
      } else {
        alert(res?.error || 'Failed to update timer.');
        roomTTLSelectHeader.value = String(currentMessageTTL);
      }
    });
  });
}

// Mobile Drawer & Overlay Management
const sidebarOverlay = document.getElementById('sidebarOverlay');

function closeSidebars() {
  sidebarLeft?.classList.remove('active');
  sidebarRight?.classList.remove('active');
  sidebarOverlay?.classList.remove('active');
}

function openSidebar(sidebar) {
  closeSidebars();
  if (sidebar) {
    sidebar.classList.add('active');
    sidebarOverlay?.classList.add('active');
  }
}

function toggleSidebar(sidebar) {
  if (sidebar?.classList.contains('active')) {
    closeSidebars();
  } else {
    openSidebar(sidebar);
  }
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', closeSidebars);
}

// Tap outside on viewport closes sidebars on mobile
document.querySelector('.word-cloud-viewport')?.addEventListener('click', (e) => {
  if (window.innerWidth <= 992 && !e.target.closest('#hudNavSelect')) {
    if (sidebarLeft?.classList.contains('active') || sidebarRight?.classList.contains('active')) {
      closeSidebars();
    }
  }
});

// HUD Dropdown View Mode & Navigation Controls
const hudViewSelect = document.getElementById('hudViewSelect');
const hudNavSelect = document.getElementById('hudNavSelect');

if (hudViewSelect) {
  hudViewSelect.addEventListener('change', (e) => {
    const mode = e.target.value;
    cloudEngine.setViewMode(mode);
  });
}

if (hudNavSelect) {
  hudNavSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'rooms') {
      toggleSidebar(sidebarLeft);
    } else if (val === 'active') {
      toggleSidebar(sidebarRight);
    }
    hudNavSelect.value = '';
  });
}

// Mobile drawer button triggers (if present)
if (leftSidebarToggle && sidebarLeft) {
  leftSidebarToggle.addEventListener('click', () => toggleSidebar(sidebarLeft));
}

if (rightSidebarToggle && sidebarRight) {
  rightSidebarToggle.addEventListener('click', () => toggleSidebar(sidebarRight));
}

function getOrAskPassword(roomName, isPrivate) {
  if (!isPrivate) return '';
  if (pendingPasswords.has(roomName)) return pendingPasswords.get(roomName);
  const typed = prompt(`🔒 Security Clearance Required\nEnter password to access room "${roomName}":`) || '';
  if (typed) pendingPasswords.set(roomName, typed);
  return typed;
}

function joinRoom(roomName, isPrivate = false, knownPassword = '') {
  const password = knownPassword || getOrAskPassword(roomName, isPrivate);
  if (isPrivate && !password) {
    showNotification('Access Denied', `Password required to join room "${roomName}".`, 'warning');
    return;
  }
  if (isLiveVideoActive) {
    stopLiveVideo(false);
  }
  socket.emit('join-room', { roomName, password }, (response) => {
    if (!response?.ok) {
      alert(response?.error || 'Unable to join room.');
      if (isPrivate) pendingPasswords.delete(roomName);
      return;
    }

    if (password) localStorage.setItem('aconnect_room_pass', password);
    currentRoom = roomName;
    window.currentRoomName = roomName;
    currentRoomNameEl.textContent = roomName;
    if (typingIndicator) typingIndicator.textContent = '';

    // Close mobile drawers on join
    if (sidebarLeft) sidebarLeft.classList.remove('active');
    if (sidebarRight) sidebarRight.classList.remove('active');
  });
}

function loadRooms(rooms) {
  roomListEl.innerHTML = '';
  const defaultRoomMissing = !rooms.some((room) => room.name === 'Default');
  const renderRooms = defaultRoomMissing ? [{ name: 'Default', count: 0, isPrivate: false, messageTTL: 86400000 }, ...rooms] : rooms;

  renderRooms.forEach((room) => {
    const li = document.createElement('li');
    li.className = `room-item ${room.name === currentRoom ? 'active' : ''}`;
    const lock = room.isPrivate ? '🔒 ' : '';
    const ttlTag = room.messageTTL > 0 ? (room.messageTTL >= 86400000 ? ' ⚡24h' : (room.messageTTL >= 3600000 ? ' ⚡1h' : ' ⚡5m')) : '';
    li.innerHTML = `<span>${lock}${room.name}${ttlTag}</span><span class="badge">${room.count}</span>`;
    li.addEventListener('click', () => joinRoom(room.name, room.isPrivate));
    roomListEl.appendChild(li);
  });
}

function updateRoomUsers(users = []) {
  currentRoomCountEl.textContent = `(${users.length} users)`;
  roomUsersEl.innerHTML = '';
  users.forEach((user) => {
    const palette = getUserColor(user.username);
    const li = document.createElement('li');
    li.className = 'user-item';
    li.innerHTML = `
      <div class="user-avatar-dot" style="border-color: ${palette.main}; color: ${palette.main};">${user.username[0].toUpperCase()}</div>
      <span style="font-weight: 600; font-size: 14px; color: ${palette.main};">${user.username}</span>
      <span class="online-pulse-dot"></span>
    `;
    roomUsersEl.appendChild(li);
  });
}

function renderTypingIndicator(username) {
  if (!typingIndicator) return;
  typingIndicator.textContent = username ? `⚡ ${username} is transmitting...` : '';
}

function sendMessage() {
  const text = sanitizeMessage(messageInput.value);
  if (!text) return;

  socket.emit('send-message', { text, room: currentRoom }, (response) => {
    if (response?.ok) {
      messageInput.value = '';
      socket.emit('typing-stop');
    } else if (response?.error) {
      alert(response.error);
    }
  });
}

const debouncedStopTyping = debounce(() => socket.emit('typing-stop'), 700);
if (messageInput) {
  messageInput.addEventListener('input', () => {
    socket.emit('typing-start');
    debouncedStopTyping();
  });
}

if (messageForm) {
  messageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
  });
}

// Modal room creation
document.getElementById('createRoomBtn')?.addEventListener('click', () => roomModal?.classList.remove('hidden'));
document.getElementById('cancelRoom')?.addEventListener('click', () => roomModal?.classList.add('hidden'));

document.getElementById('saveRoom')?.addEventListener('click', () => {
  const roomName = sanitizeMessage(roomNameInput.value).slice(0, 40);
  const password = sanitizeMessage(roomPasswordInput.value).slice(0, 40);
  const messageTTL = Number(roomTTLSelect.value);

  if (!roomName) {
    alert('Room name is required.');
    return;
  }

  socket.emit('create-room', { name: roomName, password, messageTTL }, (response) => {
    if (!response?.ok) {
      alert(response?.error || 'Failed to create room.');
      return;
    }

    roomModal.classList.add('hidden');
    roomNameInput.value = '';
    roomPasswordInput.value = '';
    roomTTLSelect.value = '86400000';
    if (password) pendingPasswords.set(roomName, password);
    joinRoom(roomName, Boolean(password), password);
  });
});

function setupEmojiPicker() {
  if (!emojiPanel) return;
  emojiPanel.innerHTML = '';
  emojis.forEach((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = emoji;
    button.addEventListener('click', () => {
      if (!messageInput) return;
      const start = messageInput.selectionStart;
      const end = messageInput.selectionEnd;
      messageInput.setRangeText(emoji, start, end, 'end');
      messageInput.focus();
    });
    emojiPanel.appendChild(button);
  });
}

document.getElementById('emojiToggle')?.addEventListener('click', () => {
  emojiPanel?.classList.toggle('hidden');
});

document.getElementById('fileButton')?.addEventListener('click', () => {
  window.isOpeningFilePicker = true;
  fileInput?.click();
  setTimeout(() => { window.isOpeningFilePicker = false; }, 30000);
});

window.addEventListener('focus', () => {
  setTimeout(() => { window.isOpeningFilePicker = false; }, 300);
});

if (fileInput) {
  fileInput.addEventListener('change', () => {
    window.isOpeningFilePicker = false;
    const file = fileInput.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('Image too large. Max 2MB.');
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      socket.emit('send-file', { dataUrl: reader.result, caption: sanitizeMessage(messageInput.value).slice(0, 200) }, (response) => {
        if (!response?.ok) {
          alert(response?.error || 'Failed to send image.');
        }
      });
      messageInput.value = '';
      fileInput.value = '';
    };
    reader.readAsDataURL(file);
  });

  fileInput.addEventListener('cancel', () => {
    window.isOpeningFilePicker = false;
  });
}

// Socket event listeners
socket.on('welcome', (data) => {
  mySocketId = data.socketId;
  myUsername = data.username || myUsername;
  if (usernameDisplay) usernameDisplay.textContent = myUsername;
  showNotification('AConnect Link Established', `Identified as ${myUsername}`);

  if (window.hasEnteredChat) {
    const savedPass = localStorage.getItem('aconnect_room_pass') || 'turtle';
    joinRoom('Default', false, savedPass);
  }
});

socket.on('online-count', (count) => {
  if (onlineCountEl) onlineCountEl.textContent = `● Online: ${count}`;
});

socket.on('rooms-list', (rooms) => loadRooms(rooms));
socket.on('rooms-updated', () => socket.emit('get-rooms'));
socket.on('room-created', () => socket.emit('get-rooms'));

socket.on('room-joined', (data) => {
  currentRoom = data.room;
  window.currentRoomName = data.room;
  currentMessageTTL = data.messageTTL !== undefined ? Number(data.messageTTL) : 86400000;

  if (roomTTLSelectHeader) {
    roomTTLSelectHeader.value = String(currentMessageTTL);
  }

  updateRoomUsers(data.users);
  cloudEngine.setMessages(data.history || [], currentMessageTTL, mySocketId);
});

socket.on('room-users', updateRoomUsers);

socket.on('new-message', (msg) => {
  cloudEngine.addMessage(msg);
});

socket.on('system-message', ({ text }) => {
  cloudEngine.addMessage({
    id: `sys-${Date.now()}-${Math.random()}`,
    username: 'SYSTEM',
    text,
    type: 'system',
    timestamp: new Date().toISOString(),
    socketId: ''
  });
});

socket.on('typing-start', ({ username }) => renderTypingIndicator(username));
socket.on('typing-stop', () => renderTypingIndicator(''));

socket.on('message-deleted', ({ messageId }) => {
  cloudEngine.removeMessage(messageId);
});

socket.on('reaction-updated', ({ messageId, reactions }) => {
  cloudEngine.updateReactions(messageId, reactions);
});

socket.on('room-purged', (data = {}) => {
  cloudEngine.clear();
  if (!data.silent && data.purgedBy) {
    showNotification('🔥 Room Purged', `All messages destroyed by ${data.purgedBy}!`);
  }
});

socket.on('join-room-error', () => {
  // Silent clear on failed room access
  cloudEngine.clear();
});

socket.on('room-ttl-updated', (data) => {
  if (data?.room === currentRoom) {
    currentMessageTTL = Number(data.messageTTL);
    if (roomTTLSelectHeader) {
      roomTTLSelectHeader.value = String(currentMessageTTL);
    }
    cloudEngine.messageTTL = currentMessageTTL;
    showNotification('⚡ Timer Updated', `${data.updatedBy || 'A user'} updated timer to ${formatTTLText(currentMessageTTL)}`);
  }
});

const instantLockBtn = document.getElementById('instantLockBtn');
if (instantLockBtn) {
  instantLockBtn.addEventListener('click', () => {
    if (typeof window.lockScreen === 'function') {
      window.lockScreen({ mode: 'instant' });
    }
  });
}

const purgeMessagesBtn = document.getElementById('purgeMessagesBtn');
if (purgeMessagesBtn) {
  purgeMessagesBtn.addEventListener('click', () => {
    if (confirm('🔥 Are you sure you want to DESTROY all messages in this room immediately?')) {
      socket.emit('purge-room-messages');
    }
  });
}

// ==========================================
// Silent Live Video Feed System (Strictly Video, Zero Audio)
// ==========================================
let isLiveVideoActive = false;
let isLocalCamOff = false;
let isVideoMinimized = false;
let localVideoStream = null;
const videoPeers = new Map(); // peerId -> RTCPeerConnection

function setVideoButtonsActive(active) {
  if (liveVideoBtn) liveVideoBtn.classList.toggle('active', active);
  if (leftLiveVideoBtn) leftLiveVideoBtn.classList.toggle('active', active);
  if (dockVideoBtn) dockVideoBtn.classList.toggle('active-video', active);
}

function initVideoPeer(targetPeerId, initiator = true) {
  if (videoPeers.has(targetPeerId)) return videoPeers.get(targetPeerId);

  const peer = createPeerConnection({
    localStream: localVideoStream,
    onIceCandidate: (candidate) => {
      socket.emit('video-feed-ice-candidate', {
        room: currentRoom,
        target: targetPeerId,
        candidate
      });
    },
    onTrack: (remoteStream) => {
      // Guarantee 100% silent live video: kill and disable all audio tracks
      remoteStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });

      if (opponentVideo) {
        opponentVideo.muted = true;
        opponentVideo.volume = 0;
        opponentVideo.srcObject = remoteStream;
        opponentVideo.play().catch(() => {});
      }
      if (opponentVideoPlaceholder) {
        opponentVideoPlaceholder.classList.add('hidden');
      }
      if (videoStatusText) {
        videoStatusText.textContent = 'Opponent visual link established';
      }
    }
  });

  videoPeers.set(targetPeerId, peer);

  if (initiator) {
    createOffer(peer)
      .then((offer) => {
        socket.emit('video-feed-offer', {
          room: currentRoom,
          target: targetPeerId,
          offer
        });
      })
      .catch((err) => console.error('Error creating video offer:', err));
  }

  return peer;
}

async function startLiveVideo() {
  if (isLiveVideoActive) return;
  isLiveVideoActive = true;
  setVideoButtonsActive(true);

  if (liveVideoHUD) {
    liveVideoHUD.classList.remove('hidden');
    liveVideoHUD.classList.remove('minimized');
  }
  if (opponentVideoPlaceholder) {
    opponentVideoPlaceholder.classList.remove('hidden');
  }
  if (videoStatusText) {
    videoStatusText.textContent = 'Requesting camera (silent link)...';
  }

  try {
    localVideoStream = await getVideoOnlyStream();
    if (localVideoPreview) {
      localVideoPreview.muted = true;
      localVideoPreview.volume = 0;
      localVideoPreview.srcObject = localVideoStream;
      localVideoPreview.play().catch(() => {});
    }
    if (localPipWrap) localPipWrap.classList.remove('hidden');
    if (videoStatusText) videoStatusText.textContent = 'Camera active. Waiting for opponent...';
  } catch (err) {
    console.warn('Local camera unavailable, switching to view-only mode:', err);
    if (localPipWrap) localPipWrap.classList.add('hidden');
    if (videoStatusText) videoStatusText.textContent = 'View-only mode (camera unavailable)';
    showNotification('📹 Live Video', 'Camera unavailable. Linked in view-only mode to watch opponent.');
  }

  socket.emit('video-feed-join', { room: currentRoom }, async (res) => {
    if (res?.peers && res.peers.length > 0) {
      for (const peerId of res.peers) {
        await initVideoPeer(peerId, true);
      }
    }
  });
}

function stopLiveVideo(notifyServer = true) {
  if (!isLiveVideoActive) return;
  isLiveVideoActive = false;
  setVideoButtonsActive(false);

  if (localVideoStream) {
    localVideoStream.getTracks().forEach((track) => track.stop());
    localVideoStream = null;
  }
  if (localVideoPreview) localVideoPreview.srcObject = null;

  videoPeers.forEach((peer) => {
    try { peer.close(); } catch (_) {}
  });
  videoPeers.clear();

  if (opponentVideo) opponentVideo.srcObject = null;
  if (opponentVideoPlaceholder) opponentVideoPlaceholder.classList.remove('hidden');

  if (liveVideoHUD) {
    liveVideoHUD.classList.add('hidden');
    liveVideoHUD.classList.remove('minimized');
  }

  if (notifyServer) {
    socket.emit('video-feed-leave', { room: currentRoom });
  }
}

async function toggleLiveVideo() {
  if (isLiveVideoActive) {
    stopLiveVideo(true);
  } else {
    await startLiveVideo();
  }
}

// UI Event Handlers
liveVideoBtn?.addEventListener('click', toggleLiveVideo);
leftLiveVideoBtn?.addEventListener('click', toggleLiveVideo);
dockVideoBtn?.addEventListener('click', toggleLiveVideo);
closeVideoBtn?.addEventListener('click', () => stopLiveVideo(true));
stopVideoFeedBtn?.addEventListener('click', () => stopLiveVideo(true));

minimizeVideoBtn?.addEventListener('click', () => {
  isVideoMinimized = !isVideoMinimized;
  liveVideoHUD?.classList.toggle('minimized', isVideoMinimized);
  minimizeVideoBtn.textContent = isVideoMinimized ? '□' : '_';
});

toggleSelfCamBtn?.addEventListener('click', () => {
  if (!localVideoStream) return;
  isLocalCamOff = !isLocalCamOff;
  localVideoStream.getVideoTracks().forEach((track) => (track.enabled = !isLocalCamOff));
  toggleSelfCamBtn.textContent = isLocalCamOff ? '📷 Cam Off' : '📷 Cam';
  if (localPipWrap) localPipWrap.style.opacity = isLocalCamOff ? '0.35' : '1';
});

// Video Socket Listeners
socket.on('video-feed-peer-joined', async ({ peerId, username }) => {
  if (isLiveVideoActive) {
    showNotification('📹 Opponent Connected', `${username || 'Opponent'} joined silent video feed`);
    await initVideoPeer(peerId, true);
  } else {
    showNotification('📹 Live Video Available', `${username || 'Opponent'} started live video feed! Click 📹 to connect.`);
    setVideoButtonsActive(true);
  }
});

socket.on('video-feed-offer', async ({ from, offer, username }) => {
  if (!isLiveVideoActive) {
    await startLiveVideo();
  }
  let peer = videoPeers.get(from);
  if (!peer) {
    peer = initVideoPeer(from, false);
  }
  try {
    const answer = await handleOffer(peer, offer);
    socket.emit('video-feed-answer', {
      room: currentRoom,
      target: from,
      answer
    });
  } catch (err) {
    console.error('Error handling video offer:', err);
  }
});

socket.on('video-feed-answer', async ({ from, answer }) => {
  const peer = videoPeers.get(from);
  if (peer) {
    try {
      await handleAnswer(peer, answer);
    } catch (err) {
      console.error('Error handling video answer:', err);
    }
  }
});

socket.on('video-feed-ice-candidate', async ({ from, candidate }) => {
  const peer = videoPeers.get(from);
  if (peer) {
    try {
      await handleIceCandidate(peer, candidate);
    } catch (err) {
      console.error('Error handling video ICE candidate:', err);
    }
  }
});

socket.on('video-feed-peer-left', ({ peerId }) => {
  if (videoPeers.has(peerId)) {
    try { videoPeers.get(peerId).close(); } catch (_) {}
    videoPeers.delete(peerId);
  }
  if (videoPeers.size === 0) {
    if (opponentVideo) opponentVideo.srcObject = null;
    if (opponentVideoPlaceholder) opponentVideoPlaceholder.classList.remove('hidden');
    if (videoStatusText) videoStatusText.textContent = 'Opponent left video feed';
  }
});

setupEmojiPicker();
socket.emit('get-rooms');
