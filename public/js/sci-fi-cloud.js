/**
 * Sci-Fi Quantum Holographic Message Cloud Engine for AnonConnect
 * Features:
 * - Cohesive holographic message nodes with user color coding & legibility
 * - "LATEST TRANSMISSION" spotlight & neon pulse ring for the newest message
 * - Dramatic dynamic scale curve (250% -> 160% -> 100%) + reaction sizing bonus
 * - Live relative timestamps ("Just now", "30s ago", "2m ago")
 * - 3 View Modes: Quantum Orbit, Chrono Flow, Heatmap
 * - Physics lerp positioning & mouse hover/click inspect interactions
 */

const NEON_PALETTES = [
  { name: 'Cyan', main: '#00f3ff', glow: 'rgba(0, 243, 255, 0.5)' },
  { name: 'Magenta', main: '#ff007f', glow: 'rgba(255, 0, 127, 0.5)' },
  { name: 'Lime', main: '#00ff9d', glow: 'rgba(0, 255, 157, 0.5)' },
  { name: 'Amber', main: '#ffb700', glow: 'rgba(255, 183, 0, 0.5)' },
  { name: 'Violet', main: '#a064ff', glow: 'rgba(160, 100, 255, 0.5)' },
  { name: 'Aqua', main: '#00d2ff', glow: 'rgba(0, 210, 255, 0.5)' },
  { name: 'Coral', main: '#ff5e62', glow: 'rgba(255, 94, 98, 0.5)' },
  { name: 'Emerald', main: '#00e676', glow: 'rgba(0, 230, 118, 0.5)' }
];

export function getUserColor(username) {
  if (!username || username === 'SYSTEM') return { main: '#8fa0c9', glow: 'rgba(143, 160, 201, 0.3)' };
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % NEON_PALETTES.length;
  return NEON_PALETTES[index];
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const created = new Date(timestamp).getTime();
  const ageMs = Math.max(0, now - created);
  
  if (ageMs < 10000) return 'Just now';
  if (ageMs < 60000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 3600000) return `${Math.floor(ageMs / 60000)}m ago`;
  return `${Math.floor(ageMs / 3600000)}h ago`;
}

export class SciFiCloudEngine {
  constructor(canvasId, bgCanvasId) {
    this.canvas = document.getElementById(canvasId);
    this.bgCanvas = document.getElementById(bgCanvasId);
    this.emptyNotice = document.getElementById('emptyCloudNotice');

    // Inspect Popover DOM
    this.inspectCard = document.getElementById('hudInspectCard');
    this.inspectAuthor = document.getElementById('inspectAuthor');
    this.inspectTime = document.getElementById('inspectTime');
    this.inspectText = document.getElementById('inspectText');
    this.inspectImageWrap = document.getElementById('inspectImageWrap');
    this.inspectImage = document.getElementById('inspectImage');
    this.inspectReactions = document.getElementById('inspectReactions');
    this.closeInspectBtn = document.getElementById('closeInspectBtn');

    this.messages = [];
    this.nodeStates = new Map(); // id -> { x, y, targetX, targetY, scale, alpha, pulse, width, height }
    this.viewMode = 'orbit'; // 'orbit', 'chrono', 'heatmap'
    this.messageTTL = 0;
    this.mySocketId = '';
    this.hoveredNodeId = null;
    this.animationFrameId = null;

    this.initBgCanvas();
    this.initCloudCanvas();
    this.initInspectCard();
    this.startExpirationTicker();
  }

  initBgCanvas() {
    if (!this.bgCanvas) return;
    this.bgCtx = this.bgCanvas.getContext('2d');
    this.particles = [];
    for (let i = 0; i < 45; i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: Math.random() * 2 + 1,
        color: NEON_PALETTES[Math.floor(Math.random() * NEON_PALETTES.length)].main,
        alpha: Math.random() * 0.5 + 0.2
      });
    }
    this.resizeCanvases();
  }

  initCloudCanvas() {
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this.resizeCanvases();
    window.addEventListener('resize', () => this.resizeCanvases());

    // Mouse hover & click events
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredNodeId = null;
      this.canvas.style.cursor = 'default';
    });
    this.canvas.addEventListener('click', (e) => this.handleClick(e));

    // Start cloud animation loop
    this.animateCloud();
  }

  resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;
    if (this.bgCanvas) {
      this.bgCanvas.width = window.innerWidth * dpr;
      this.bgCanvas.height = window.innerHeight * dpr;
      if (this.bgCtx) this.bgCtx.scale(dpr, dpr);
    }
    if (this.canvas) {
      const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
      this.canvasWidth = rect.width;
      this.canvasHeight = rect.height;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      if (this.ctx) this.ctx.scale(dpr, dpr);
    }
  }

  initInspectCard() {
    if (this.closeInspectBtn) {
      this.closeInspectBtn.addEventListener('click', () => {
        this.inspectCard.classList.add('hidden');
      });
    }

    document.querySelectorAll('.inspect-react-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const messageId = this.inspectCard.dataset.messageId;
        const emoji = btn.dataset.emoji;
        if (messageId && emoji && this.onReactionClick) {
          this.onReactionClick(messageId, emoji);
        }
      });
    });
  }

  setViewMode(mode) {
    if (['orbit', 'chrono', 'heatmap'].includes(mode)) {
      this.viewMode = mode;
      this.recalculateTargets();
    }
  }

  clear() {
    this.messages = [];
    this.nodeStates.clear();
    if (this.emptyNotice) this.emptyNotice.style.display = 'flex';
  }

  setMessages(messagesList, messageTTL = 0, mySocketId = '') {
    this.clear();
    this.messageTTL = messageTTL;
    this.mySocketId = mySocketId;
    
    // Sort chronologically ascending (oldest first, newest last)
    this.messages = messagesList.filter(m => m.type !== 'system').sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    this.messages.forEach(msg => this.initNodeState(msg));
    this.recalculateTargets();
  }

  addMessage(data) {
    if (data.type === 'system') return;
    if (this.messages.some((m) => m.id === data.id)) return;
    
    this.messages.push(data);
    this.initNodeState(data, true); // brand new message triggers pulse effect!
    this.recalculateTargets();
  }

  removeMessage(messageId) {
    this.messages = this.messages.filter((m) => m.id !== messageId);
    this.nodeStates.delete(messageId);

    if (this.inspectCard && this.inspectCard.dataset.messageId === messageId) {
      this.inspectCard.classList.add('hidden');
    }

    this.recalculateTargets();
  }

  updateReactions(messageId, reactions) {
    const msg = this.messages.find((m) => m.id === messageId);
    if (msg) {
      msg.reactions = reactions;
      // Trigger a visual pulse on node when reaction is updated
      const state = this.nodeStates.get(messageId);
      if (state) state.pulse = 1.0;
    }

    if (this.inspectCard && this.inspectCard.dataset.messageId === messageId) {
      this.renderInspectReactions(reactions);
    }
  }

  initNodeState(msg, isNew = false) {
    const centerX = (this.canvasWidth || window.innerWidth) / 2;
    const centerY = (this.canvasHeight || window.innerHeight) / 2;

    this.nodeStates.set(msg.id, {
      x: centerX + (Math.random() - 0.5) * 80,
      y: centerY + (Math.random() - 0.5) * 80,
      targetX: centerX,
      targetY: centerY,
      scale: isNew ? 2.5 : 1.0,
      alpha: 1.0,
      pulse: isNew ? 1.5 : 0,
      width: 160,
      height: 60
    });
  }

  recalculateTargets() {
    if (this.messages.length === 0) {
      if (this.emptyNotice) this.emptyNotice.style.display = 'flex';
      return;
    }
    if (this.emptyNotice) this.emptyNotice.style.display = 'none';

    const w = this.canvasWidth || window.innerWidth;
    const h = this.canvasHeight || window.innerHeight;
    const centerX = w / 2;
    const centerY = h / 2;
    const total = this.messages.length;

    // Latest message index is total - 1
    const latestId = this.messages[total - 1]?.id;

    const isMobile = w < 650;

    if (this.viewMode === 'orbit') {
      // Quantum Orbit: Latest message is in focal center-top spot, older ones orbit around
      this.messages.forEach((msg, idx) => {
        const state = this.nodeStates.get(msg.id);
        if (!state) return;

        const isLatest = msg.id === latestId;
        const indexFromLatest = total - 1 - idx; // 0 for newest, 1 for 2nd newest, etc.

        if (isLatest) {
          state.targetX = centerX;
          state.targetY = isMobile ? 80 : Math.max(90, centerY - h * 0.22);
        } else {
          const angle = indexFromLatest * 0.95 + 0.4;
          const radius = (isMobile ? 65 : 110) + indexFromLatest * (isMobile ? 35 : 55);
          const maxRadiusX = isMobile ? w * 0.28 : w * 0.42;
          const maxRadiusY = isMobile ? h * 0.28 : h * 0.38;

          const rx = Math.min(radius, maxRadiusX);
          const ry = Math.min(radius * 0.7, maxRadiusY);

          state.targetX = centerX + Math.cos(angle) * rx;
          state.targetY = centerY + Math.sin(angle) * ry + (isMobile ? 20 : 30);
        }
      });
    } else if (this.viewMode === 'chrono') {
      // Chrono Flow: Single column on mobile, 2 columns on desktop
      const rowHeight = isMobile ? 65 : 75;
      const startY = isMobile ? 70 : 80;

      this.messages.forEach((msg, idx) => {
        const state = this.nodeStates.get(msg.id);
        if (!state) return;

        const indexFromLatest = total - 1 - idx; // 0 = newest at top

        if (isMobile) {
          state.targetX = centerX;
          state.targetY = startY + indexFromLatest * rowHeight;
        } else {
          const col = indexFromLatest % 2;
          const row = Math.floor(indexFromLatest / 2);
          if (indexFromLatest === 0) {
            state.targetX = centerX;
            state.targetY = startY;
          } else {
            const offsetX = (col === 0 ? -1 : 1) * Math.min(220, w * 0.25);
            state.targetX = centerX + offsetX;
            state.targetY = startY + 50 + row * rowHeight;
          }
        }
      });
    } else if (this.viewMode === 'heatmap') {
      // Heatmap Mode: Sorted by reaction count + recency score
      const scored = [...this.messages].map(msg => {
        const reactionCount = (msg.reactions || []).reduce((sum, r) => sum + (r.count || 0), 0);
        const ageMs = Date.now() - new Date(msg.timestamp).getTime();
        const score = reactionCount * 3 + Math.max(0, 10 - ageMs / 30000);
        return { msg, score };
      }).sort((a, b) => b.score - a.score);

      scored.forEach((item, rank) => {
        const state = this.nodeStates.get(item.msg.id);
        if (!state) return;

        const angle = rank * 1.2;
        const radius = (isMobile ? 50 : 70) + rank * (isMobile ? 35 : 60);
        state.targetX = centerX + Math.cos(angle) * Math.min(radius, w * (isMobile ? 0.28 : 0.4));
        state.targetY = centerY + Math.sin(angle) * Math.min(radius * 0.65, h * (isMobile ? 0.28 : 0.35));
      });
    }
  }

  handleMouseMove(e) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let foundHover = null;

    // Check hit test from front to back
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      const state = this.nodeStates.get(msg.id);
      if (!state) continue;

      const halfW = state.width / 2;
      const halfH = state.height / 2;

      if (mx >= state.x - halfW && mx <= state.x + halfW && my >= state.y - halfH && my <= state.y + halfH) {
        foundHover = msg.id;
        break;
      }
    }

    this.hoveredNodeId = foundHover;
    this.canvas.style.cursor = foundHover ? 'pointer' : 'default';
  }

  handleClick(e) {
    if (this.hoveredNodeId) {
      const msg = this.messages.find((m) => m.id === this.hoveredNodeId);
      if (msg) this.showInspectCard(msg);
    }
  }

  calculateScale(msg, isLatest) {
    const now = Date.now();
    const created = new Date(msg.timestamp).getTime();
    const ageSeconds = Math.max(0, (now - created) / 1000);
    const screenWidth = this.canvasWidth || window.innerWidth;
    const isMobile = screenWidth < 650;
    
    // Dynamic Recency Curve (capped on mobile so nodes fit inside viewport)
    let recencyScale = 1.0;
    if (ageSeconds < 15) recencyScale = isMobile ? 1.3 : 2.2;
    else if (ageSeconds < 45) recencyScale = isMobile ? 1.15 : 1.7;
    else if (ageSeconds < 120) recencyScale = isMobile ? 1.05 : 1.35;
    else if (ageSeconds < 300) recencyScale = isMobile ? 0.95 : 1.1;
    else recencyScale = isMobile ? 0.85 : 0.9;

    // Reaction bonus (+15% scale per reaction up to +45%)
    const reactionCount = (msg.reactions || []).reduce((sum, r) => sum + (r.count || 0), 0);
    const reactionBonus = Math.min(0.45, reactionCount * 0.15);

    const baseCalculated = recencyScale + reactionBonus;
    return isLatest 
      ? Math.max(isMobile ? 1.25 : 1.9, baseCalculated) 
      : Math.max(isMobile ? 0.8 : 0.85, baseCalculated);
  }

  animateCloud() {
    if (!this.ctx) return;

    const ctx = this.ctx;
    const w = this.canvasWidth || window.innerWidth;
    const h = this.canvasHeight || window.innerHeight;

    ctx.clearRect(0, 0, w, h);

    const time = Date.now() * 0.002;
    const latestId = this.messages[this.messages.length - 1]?.id;

    // Update particles on background canvas if initialized
    if (this.bgCtx && this.bgCanvas) {
      this.animateBgFrame();
    }

    // Render connecting orbit lines in Quantum Orbit mode
    if (this.viewMode === 'orbit' && this.messages.length > 1) {
      const latestState = this.nodeStates.get(latestId);
      if (latestState) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 243, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        this.messages.forEach(msg => {
          if (msg.id === latestId) return;
          const s = this.nodeStates.get(msg.id);
          if (s) {
            ctx.beginPath();
            ctx.moveTo(latestState.x, latestState.y);
            ctx.lineTo(s.x, s.y);
            ctx.stroke();
          }
        });
        ctx.restore();
      }
    }

    // Render nodes
    this.messages.forEach((msg, idx) => {
      const state = this.nodeStates.get(msg.id);
      if (!state) return;

      const isLatest = msg.id === latestId;
      const isHovered = msg.id === this.hoveredNodeId;
      const palette = getUserColor(msg.username);

      // Lerp positioning
      state.x += (state.targetX - state.x) * 0.08;
      state.y += (state.targetY - state.y) * 0.08;

      // Slight floating motion
      const floatY = Math.sin(time + idx * 0.7) * (isLatest ? 3 : 2);
      const renderY = state.y + floatY;

      // Target scale & Lerp scale
      const targetScale = this.calculateScale(msg, isLatest) * (isHovered ? 1.15 : 1.0);
      state.scale += (targetScale - state.scale) * 0.1;

      // Decay pulse
      if (state.pulse > 0) state.pulse *= 0.92;

      // Render Holographic Node Box
      this.renderNode(ctx, msg, state.x, renderY, state.scale, palette, isLatest, isHovered, idx, state);
    });

    this.animationFrameId = requestAnimationFrame(() => this.animateCloud());
  }

  animateBgFrame() {
    if (!this.bgCtx || !this.bgCanvas) return;
    const ctx = this.bgCtx;
    const dpr = window.devicePixelRatio || 1;
    const w = this.bgCanvas.width / dpr;
    const h = this.bgCanvas.height / dpr;

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.03)';
    ctx.lineWidth = 1;
    const gridSize = 60;
    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Floating particles
    this.particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  renderNode(ctx, msg, x, y, scale, palette, isLatest, isHovered, index, state) {
    ctx.save();

    const canvasW = this.canvasWidth || window.innerWidth;
    const isMobile = canvasW < 650;

    const baseFontSize = Math.floor((isMobile ? 12 : 13) * scale);
    ctx.font = `600 ${baseFontSize}px 'Space Grotesk', sans-serif`;

    const textStr = msg.text || (msg.type === 'image' ? '📷 Hologram Image' : '');
    const maxTextLen = Math.floor((isMobile ? 20 : 28) * (scale > 1.8 ? 1.5 : 1));
    const displayText = textStr.length > maxTextLen ? textStr.slice(0, maxTextLen) + '…' : textStr;

    const relTime = formatRelativeTime(msg.timestamp);
    const authorStr = msg.username || 'Anon';

    // Measure node dimensions
    const textMetrics = ctx.measureText(displayText);
    const textWidth = textMetrics.width;

    ctx.font = `500 ${Math.max(10, Math.floor((isMobile ? 9.5 : 10) * scale))}px 'Inter', sans-serif`;
    const authorMetrics = ctx.measureText(`${authorStr} • ${relTime}`);
    const headerWidth = authorMetrics.width + (isLatest ? (isMobile ? 80 : 120) : 40);

    const paddingX = Math.floor((isMobile ? 12 : 16) * scale);
    const maxAllowedWidth = canvasW - 24;
    const calculatedNodeW = Math.max(isMobile ? 150 : 180 * (scale > 1.8 ? 1.3 : 1), Math.max(textWidth, headerWidth) + paddingX * 2);
    const nodeWidth = Math.min(calculatedNodeW, maxAllowedWidth);
    const nodeHeight = Math.floor((isLatest ? (isMobile ? 62 : 74) : (isMobile ? 54 : 64)) * (scale > 1.8 ? 1.25 : 1));

    state.width = nodeWidth;
    state.height = nodeHeight;

    const halfW = nodeWidth / 2;
    const halfH = nodeHeight / 2;
    
    // Clamp rectX strictly within screen bounds
    let rectX = x - halfW;
    rectX = Math.max(12, Math.min(canvasW - nodeWidth - 12, rectX));
    const rectY = y - halfH;
    const radius = Math.min(12, Math.floor(8 * scale));

    // Outer Neon Glow Pulse for Latest or Hovered node
    if (isLatest || isHovered || state.pulse > 0.1) {
      ctx.shadowColor = isLatest ? '#00f3ff' : palette.main;
      ctx.shadowBlur = (isLatest ? 22 : 12) + (state.pulse * 15);
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 8;
    }

    // Node Background (Glassmorphism dark sci-fi card)
    ctx.fillStyle = isLatest ? 'rgba(8, 20, 36, 0.94)' : 'rgba(12, 16, 26, 0.88)';
    ctx.beginPath();
    ctx.roundRect(rectX, rectY, nodeWidth, nodeHeight, radius);
    ctx.fill();

    // Node Border
    ctx.lineWidth = isLatest ? 2.5 : isHovered ? 2 : 1;
    ctx.strokeStyle = isLatest ? '#00f3ff' : isHovered ? palette.main : 'rgba(0, 243, 255, 0.25)';
    ctx.stroke();

    // Corner Sci-Fi Tech Accents
    ctx.fillStyle = palette.main;
    ctx.fillRect(rectX, rectY, 4, 4);
    ctx.fillRect(rectX + nodeWidth - 4, rectY, 4, 4);
    ctx.fillRect(rectX, rectY + nodeHeight - 4, 4, 4);
    ctx.fillRect(rectX + nodeWidth - 4, rectY + nodeHeight - 4, 4, 4);

    // Header Row: Author + Recency Badge + Timestamp
    ctx.shadowBlur = 0;
    const headerY = rectY + Math.floor(20 * (scale > 1.8 ? 1.15 : 1));

    // Author Name
    ctx.fillStyle = palette.main;
    ctx.font = `700 ${Math.max(10, Math.floor(12 * (scale > 1.8 ? 1.15 : 1)))}px 'Rajdhani', sans-serif`;
    ctx.fillText(authorStr.toUpperCase(), rectX + paddingX, headerY);

    const authorWidth = ctx.measureText(authorStr.toUpperCase()).width;

    // Recency Badge Tag (e.g. ⚡ LATEST or #1)
    if (isLatest) {
      const badgeX = rectX + paddingX + authorWidth + 8;
      ctx.fillStyle = '#00f3ff';
      ctx.font = `800 ${Math.max(9, Math.floor(9.5 * (scale > 1.8 ? 1.1 : 1)))}px 'Space Grotesk', sans-serif`;
      ctx.fillText(`⚡ LATEST`, badgeX, headerY);
    }

    // Timestamp Tag
    ctx.fillStyle = 'rgba(160, 180, 210, 0.75)';
    ctx.font = `500 ${Math.max(9, Math.floor(9.5 * (scale > 1.8 ? 1.1 : 1)))}px 'Inter', sans-serif`;
    ctx.fillText(relTime, rectX + nodeWidth - paddingX - ctx.measureText(relTime).width, headerY);

    // Subtle Divider Line between Username Header and Message Text
    const dividerY = headerY + Math.floor(7 * (scale > 1.8 ? 1.1 : 1));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rectX + paddingX, dividerY);
    ctx.lineTo(rectX + nodeWidth - paddingX, dividerY);
    ctx.stroke();

    // Body Message Text with generous vertical gap below header line
    const bodyY = dividerY + Math.floor(21 * (scale > 1.8 ? 1.15 : 1));
    ctx.fillStyle = isLatest ? '#ffffff' : '#e2e8f0';
    ctx.font = `600 ${baseFontSize}px 'Space Grotesk', sans-serif`;
    ctx.fillText(displayText, rectX + paddingX, bodyY);

    // Reaction Chips Badges
    if (msg.reactions && msg.reactions.length > 0) {
      const rxStr = msg.reactions.map(r => `${r.emoji}${r.count}`).join(' ');
      ctx.font = `600 ${Math.max(10, Math.floor(10 * scale))}px sans-serif`;
      ctx.fillStyle = '#ffb700';
      ctx.fillText(rxStr, rectX + nodeWidth - paddingX - ctx.measureText(rxStr).width, bodyY);
    }

    ctx.restore();
  }

  showInspectCard(msg) {
    if (!this.inspectCard) return;

    const palette = getUserColor(msg.username);
    this.inspectCard.dataset.messageId = msg.id;

    if (this.inspectAuthor) {
      this.inspectAuthor.textContent = msg.username;
      this.inspectAuthor.style.color = palette.main;
    }

    if (this.inspectTime) {
      const date = new Date(msg.timestamp);
      this.inspectTime.textContent = isNaN(date.getTime()) ? '' : `${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${formatRelativeTime(msg.timestamp)})`;
    }

    if (this.inspectText) {
      this.inspectText.textContent = msg.text || (msg.type === 'image' ? '[Shared Hologram Image]' : '');
    }

    if (msg.type === 'image' && msg.imageData) {
      this.inspectImage.src = msg.imageData;
      this.inspectImageWrap.classList.remove('hidden');
    } else {
      this.inspectImageWrap.classList.add('hidden');
    }

    this.renderInspectReactions(msg.reactions);
    this.inspectCard.classList.remove('hidden');
  }

  renderInspectReactions(reactions = []) {
    if (!this.inspectReactions) return;
    this.inspectReactions.innerHTML = '';
    reactions.forEach((r) => {
      const chip = document.createElement('span');
      chip.className = 'reaction-chip';
      chip.textContent = `${r.emoji} ${r.count}`;
      this.inspectReactions.appendChild(chip);
    });
  }

  startExpirationTicker() {
    setInterval(() => {
      // Re-sort and recalculate relative timestamps & layout every 3 seconds
      if (this.messages.length > 0) {
        this.recalculateTargets();
      }

      if (this.messageTTL > 0 && this.messages.length > 0) {
        const now = Date.now();
        const expired = this.messages.filter((m) => {
          const created = new Date(m.timestamp).getTime();
          return now - created >= this.messageTTL;
        });

        if (expired.length > 0) {
          expired.forEach((m) => this.removeMessage(m.id));
        }
      }
    }, 3000);
  }
}
