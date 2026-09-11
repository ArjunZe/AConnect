import { createSocket } from './socket-client.js';
import { debounce, generateUsername, sanitizeMessage, showNotification } from './utils.js';
import { SciFiCloudEngine, getUserColor } from './sci-fi-cloud.js';
import { initInactivityLock } from './inactivity-lock.js';

const socket = createSocket('/chat');
initInactivityLock(socket);

// UI Elements
const usernameDisplay = document.getElementById('usernameDisplay');
const onlineCountEl = document.getElementById('onlineCount');
const roomListEl = document.getElementById('roomList');
const currentRoomNameEl = document.getElementById('currentRoomName');
const currentRoomCountEl = document.getElementById('currentRoomCount');
const roomTTLBadge = document.getElementById('roomTTLBadge');
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

// Mobile drawer buttons
const leftSidebarToggle = document.getElementById('leftSidebarToggle');
const rightSidebarToggle = document.getElementById('rightSidebarToggle');
const sidebarLeft = document.getElementById('sidebarLeft');
const sidebarRight = document.getElementById('sidebarRight');

const emojis = ['😀', '😂', '😍', '😎', '🤖', '🔥', '🎉', '✨', '🙌', '🚀', '💡', '⚡', '👏', '🥳', '🤔', '😇', '🛸', '🌌'];

let currentRoom = 'Default';
let currentMessageTTL = 5 * 60 * 1000;
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

function joinRoom(roomName, isPrivate = false) {
  const password = getOrAskPassword(roomName, isPrivate);
  if (isPrivate && !password) {
    showNotification('Access Denied', `Password required to join room "${roomName}".`, 'warning');
    return;
  }
  socket.emit('join-room', { roomName, password }, (response) => {
    if (!response?.ok) {
      alert(response?.error || 'Unable to join room.');
      if (isPrivate) pendingPasswords.delete(roomName);
      return;
    }

    if (password) localStorage.setItem('aconnect_room_pass', password);
    currentRoom = roomName;
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
  const renderRooms = defaultRoomMissing ? [{ name: 'Default', count: 0, isPrivate: false, messageTTL: 300000 }, ...rooms] : rooms;

  renderRooms.forEach((room) => {
    const li = document.createElement('li');
    li.className = `room-item ${room.name === currentRoom ? 'active' : ''}`;
    const lock = room.isPrivate ? '🔒 ' : '';
    const ttlTag = room.messageTTL > 0 ? ' ⚡' : '';
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
    roomTTLSelect.value = '300000';
    if (password) pendingPasswords.set(roomName, password);
    joinRoom(roomName, Boolean(password));
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

document.getElementById('fileButton')?.addEventListener('click', () => fileInput?.click());

if (fileInput) {
  fileInput.addEventListener('change', () => {
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
}

// Socket event listeners
socket.on('welcome', (data) => {
  mySocketId = data.socketId;
  myUsername = data.username || myUsername;
  if (usernameDisplay) usernameDisplay.textContent = myUsername;
  showNotification('AConnect Link Established', `Identified as ${myUsername}`);
  joinRoom('Default', true);
});

socket.on('online-count', (count) => {
  if (onlineCountEl) onlineCountEl.textContent = `● Online: ${count}`;
});

socket.on('rooms-list', (rooms) => loadRooms(rooms));
socket.on('rooms-updated', () => socket.emit('get-rooms'));
socket.on('room-created', () => socket.emit('get-rooms'));

socket.on('room-joined', (data) => {
  currentRoom = data.room;
  currentMessageTTL = data.messageTTL || 0;

  if (roomTTLBadge) {
    if (currentMessageTTL > 0) {
      const mins = Math.round(currentMessageTTL / 60000);
      roomTTLBadge.textContent = `⚡ ${mins}-Min Expire`;
      roomTTLBadge.classList.remove('hidden');
    } else {
      roomTTLBadge.textContent = `♾️ Persistent`;
      roomTTLBadge.classList.remove('hidden');
    }
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

socket.on('room-purged', ({ purgedBy }) => {
  cloudEngine.clear();
  showNotification('🔥 Room Purged', `All messages destroyed by ${purgedBy}!`);
});

const purgeMessagesBtn = document.getElementById('purgeMessagesBtn');
if (purgeMessagesBtn) {
  purgeMessagesBtn.addEventListener('click', () => {
    if (confirm('🔥 Are you sure you want to DESTROY all messages in this room immediately?')) {
      socket.emit('purge-room-messages');
    }
  });
}

setupEmojiPicker();
socket.emit('get-rooms');
