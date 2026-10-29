const fs = require('fs');
const path = require('path');
const http = require('http');
const { pipeline, Transform } = require('stream');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 9876;
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DEFAULT_ROOM_PASSWORD = String(process.env.DEFAULT_ROOM_PASSWORD || 'turtle').trim();
const ROOM_IDLE_DELETE_MS = 5 * 60 * 1000;
const MAX_MESSAGE_HISTORY = 50;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const MESSAGE_RATE_LIMIT_WINDOW = 60 * 1000;
const MESSAGE_RATE_LIMIT_MAX = 30;

const DATA_DIR = process.env.DATA_DIR || process.env.PERSISTENT_STORAGE_DIR || path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.warn('Could not create DATA_DIR:', e);
  }
}

// UPLOADS_DIR defaults to DATA_DIR/uploads if DATA_DIR is explicitly configured, or DATA_DIR directly
const UPLOADS_DIR = process.env.UPLOADS_DIR || (process.env.DATA_DIR ? path.join(DATA_DIR, 'uploads') : DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch (e) {
    console.warn('Could not create UPLOADS_DIR:', e);
  }
}

const GALLERY_MANIFEST_PATH = process.env.GALLERY_MANIFEST_PATH || path.join(DATA_DIR, 'gallery-manifest.json');
const CHAT_STORE_PATH = process.env.CHAT_STORE_PATH || path.join(DATA_DIR, 'chat-store.json');

function getGalleryManifest() {
  try {
    if (fs.existsSync(GALLERY_MANIFEST_PATH)) {
      const data = fs.readFileSync(GALLERY_MANIFEST_PATH, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Error reading gallery manifest:', e);
  }
  return [];
}

function addToGalleryManifest(entry) {
  try {
    const list = getGalleryManifest();
    const filtered = list.filter((item) => item.imageId !== entry.imageId);
    filtered.unshift(entry);
    fs.writeFile(GALLERY_MANIFEST_PATH, JSON.stringify(filtered.slice(0, 500), null, 2), (err) => {
      if (err) console.warn('Error writing gallery manifest:', err);
    });
  } catch (e) {
    console.warn('Error writing gallery manifest:', e);
  }
}

const LOGIN_HISTORY_PATH = process.env.LOGIN_HISTORY_PATH || path.join(DATA_DIR, 'login-history.json');

function getLoginHistory() {
  try {
    if (fs.existsSync(LOGIN_HISTORY_PATH)) {
      const data = fs.readFileSync(LOGIN_HISTORY_PATH, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Error reading login history:', e);
  }
  return [];
}

function saveLoginHistory(list) {
  try {
    fs.writeFile(LOGIN_HISTORY_PATH, JSON.stringify(list, null, 2), (err) => {
      if (err) console.warn('Error writing login history:', err);
    });
  } catch (e) {
    console.warn('Error writing login history:', e);
  }
}

function parseUserAgentFallback(ua = '') {
  let os = 'Unknown OS';
  if (/iPad/i.test(ua)) {
    const match = ua.match(/OS (\d+[._]\d+)/i);
    os = 'iOS' + (match ? ' ' + match[1].replace(/_/g, '.') : '');
  } else if (/iPhone|iPod/i.test(ua)) {
    const match = ua.match(/OS (\d+[._]\d+)/i);
    os = 'iOS' + (match ? ' ' + match[1].replace(/_/g, '.') : '');
  } else if (/CriOS|FxiOS|EdgiOS/.test(ua)) {
    os = 'iOS';
  } else if (/Android/i.test(ua)) {
    const match = ua.match(/Android\s+([\d.]+)/i);
    os = 'Android' + (match ? ' ' + match[1] : '');
  } else if (/Windows NT 10.0/i.test(ua)) {
    os = 'Windows 10/11';
  } else if (/Windows NT 6.3/i.test(ua)) {
    os = 'Windows 8.1';
  } else if (/Windows NT 6.1/i.test(ua)) {
    os = 'Windows 7';
  } else if (/Windows/i.test(ua)) {
    os = 'Windows';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    const match = ua.match(/Mac OS X\s+([\d_]+)/i);
    os = 'macOS' + (match ? ' ' + match[1].replace(/_/g, '.') : '');
  } else if (/CrOS/i.test(ua)) {
    os = 'ChromeOS';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  }

  let browser = 'Unknown Browser';
  if (/Brave/i.test(ua)) {
    browser = 'Brave';
  } else if (/EdgiOS\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/EdgiOS\/([\d.]+)/i);
    browser = 'Edge iOS' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Edg\//i.test(ua)) {
    const match = ua.match(/Edg\/([\d.]+)/i);
    browser = 'Edge' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/OPR\/|Opera/i.test(ua)) {
    const match = ua.match(/(?:OPR|Opera)\/([\d.]+)/i);
    browser = 'Opera' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/SamsungBrowser/i.test(ua)) {
    const match = ua.match(/SamsungBrowser\/([\d.]+)/i);
    browser = 'Samsung Internet' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/CriOS\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/CriOS\/([\d.]+)/i);
    browser = 'Chrome iOS' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Chrome\/([\d.]+)/i.test(ua) && !/Mobile Safari/i.test(ua)) {
    const match = ua.match(/Chrome\/([\d.]+)/i);
    browser = 'Chrome' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Firefox\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/Firefox\/([\d.]+)/i);
    browser = 'Firefox' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/FxiOS\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/FxiOS\/([\d.]+)/i);
    browser = 'Firefox iOS' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Safari/i.test(ua) && /Version\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/Version\/([\d.]+)/i);
    browser = 'Safari' + (match ? ' ' + match[1].split('.')[0] : '');
  } else if (/Safari/i.test(ua)) {
    browser = 'Safari';
  } else if (/Chrome/i.test(ua)) {
    browser = 'Chrome Mobile';
  }

  let deviceType = 'desktop';
  let deviceModel = 'Desktop PC';

  if (/iPad/i.test(ua)) {
    deviceType = 'tablet';
    deviceModel = 'Apple iPad';
  } else if (/iPhone/i.test(ua) || /CriOS|FxiOS|EdgiOS/.test(ua) || /iP(hone|od)/i.test(ua)) {
    deviceType = 'mobile';
    deviceModel = 'Apple iPhone';
  } else if (/tablet|playbook|silk/i.test(ua)) {
    deviceType = 'tablet';
    deviceModel = 'Tablet Device';
  } else if (/Mobile|Android|IEMobile|BlackBerry/i.test(ua)) {
    deviceType = 'mobile';
    if (/Pixel/i.test(ua)) {
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
  return {
    deviceName,
    deviceModel,
    deviceType,
    os,
    browser
  };
}

function cleanClientIp(ipStr = '') {
  let ip = String(ipStr || '').trim();
  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  if (ip === '::1' || ip === '127.0.0.1') {
    return '127.0.0.1 (Localhost)';
  }
  return ip || 'Unknown IP';
}

function recordLoginEvent(data = {}) {
  try {
    const list = getLoginHistory();
    const rawIp = data.ip || '127.0.0.1';
    const cleanIp = cleanClientIp(rawIp);
    const now = new Date().toISOString();

    const fallback = parseUserAgentFallback(data.userAgent || '');
    const deviceModel = String(data.deviceModel || fallback.deviceModel || 'Terminal Node').trim().slice(0, 80);
    const os = String(data.os || fallback.os || 'Unknown OS').trim().slice(0, 80);
    const browser = String(data.browser || fallback.browser || 'Unknown Browser').trim().slice(0, 80);
    const deviceType = ['mobile', 'tablet', 'desktop'].includes(data.deviceType) ? data.deviceType : fallback.deviceType;
    const deviceName = String(data.deviceName || `${deviceModel} (${os} • ${browser})`).trim().slice(0, 120);
    const screen = String(data.screen || 'N/A').trim().slice(0, 40);
    const timezone = String(data.timezone || 'UTC').trim().slice(0, 60);
    const language = String(data.language || 'en').trim().slice(0, 30);

    let deviceId = String(data.deviceId || '').trim();
    if (!deviceId) {
      const fpStr = `${deviceModel}_${os}_${browser}_${screen}_${timezone}`;
      let hash = 0;
      for (let i = 0; i < fpStr.length; i++) {
        hash = (hash << 5) - hash + fpStr.charCodeAt(i);
        hash |= 0;
      }
      deviceId = `dev_${Math.abs(hash).toString(36)}`;
    }
    deviceId = deviceId.slice(0, 80);

    let device = list.find((d) => d.deviceId === deviceId);
    if (!device) {
      device = {
        deviceId,
        deviceName,
        deviceModel,
        deviceType,
        os,
        browser,
        screen,
        timezone,
        language,
        firstSeen: now,
        lastSeen: now,
        lastIp: cleanIp,
        totalLogins: 0,
        logins: []
      };
      list.unshift(device);
    } else {
      device.deviceName = deviceName;
      device.deviceModel = deviceModel;
      device.deviceType = deviceType;
      device.os = os;
      device.browser = browser;
      if (screen && screen !== 'N/A') device.screen = screen;
      if (timezone && timezone !== 'UTC') device.timezone = timezone;
      if (language) device.language = language;
      device.lastSeen = now;
      device.lastIp = cleanIp;
    }

    const action = String(data.action || 'Security Clearance Login').trim().slice(0, 80);
    const username = String(data.username || 'Anonymous').trim().slice(0, 60);
    const room = String(data.room || 'Default').trim().slice(0, 60);

    // Debounce consecutive logs from the same device within 90 seconds unless action differs
    const lastLogin = device.logins && device.logins[0];
    const timeSinceLast = lastLogin ? (Date.now() - new Date(lastLogin.timestamp).getTime()) : Infinity;

    if (timeSinceLast > 90 * 1000 || (lastLogin && lastLogin.action !== action)) {
      device.totalLogins = (device.totalLogins || (device.logins ? device.logins.length : 0)) + 1;
      if (!Array.isArray(device.logins)) device.logins = [];
      device.logins.unshift({
        id: 'log_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        timestamp: now,
        ip: cleanIp,
        action,
        username,
        room
      });
      if (device.logins.length > 80) {
        device.logins = device.logins.slice(0, 80);
      }
    } else if (lastLogin) {
      lastLogin.lastActive = now;
      lastLogin.ip = cleanIp;
      if (username && username !== 'Anonymous') lastLogin.username = username;
      if (room && room !== 'Default') lastLogin.room = room;
    }

    list.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
    saveLoginHistory(list.slice(0, 200));
    return device;
  } catch (err) {
    console.warn('Failed to record login event:', err);
    return null;
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

const httpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(httpLimiter);

// Upload endpoint for camera & gallery images (up to 50MB) - High-throughput stream pipeline
app.post('/api/upload', (req, res) => {
  const contentType = (req.headers['content-type'] || 'image/jpeg').toLowerCase();
  if (!contentType.startsWith('image/')) {
    return res.status(400).json({ ok: false, error: 'Only image files are allowed.' });
  }

  const rawFileName = req.headers['x-file-name'] ? decodeURIComponent(req.headers['x-file-name']) : 'image.jpg';
  const cleanExt = path.extname(rawFileName).toLowerCase().replace(/[^a-z0-9.]/g, '') ||
    (contentType.includes('png') ? '.png' : (contentType.includes('webp') ? '.webp' : (contentType.includes('gif') ? '.gif' : '.jpg')));
  const imageId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const savedFileName = `${imageId}${cleanExt}`;
  const filePath = path.join(UPLOADS_DIR, savedFileName);

  const writeStream = fs.createWriteStream(filePath, { highWaterMark: 1024 * 1024 });
  let bytesWritten = 0;
  const maxBytes = MAX_FILE_SIZE_BYTES;

  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      bytesWritten += chunk.length;
      if (bytesWritten > maxBytes) {
        const err = new Error('LIMIT_EXCEEDED');
        err.code = 'LIMIT_EXCEEDED';
        return callback(err);
      }
      callback(null, chunk);
    }
  });

  pipeline(req, limiter, writeStream, (err) => {
    if (err) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      if (!res.headersSent) {
        if (err.code === 'LIMIT_EXCEEDED') {
          return res.status(413).json({ ok: false, error: 'Image exceeds maximum allowed size of 50MB.' });
        }
        console.error('Upload stream error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to save image file.' });
      }
      return;
    }

    const imageUrl = `/uploads/${savedFileName}`;
    const downloadUrl = `/api/images/${imageId}/download?name=${encodeURIComponent(rawFileName)}`;

    addToGalleryManifest({
      imageId,
      fileName: rawFileName,
      imageUrl,
      thumbUrl: imageUrl,
      downloadUrl,
      fileSize: bytesWritten,
      mimeType: contentType,
      timestamp: new Date().toISOString()
    });

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || req.ip;
    const userAgent = req.headers['user-agent'] || '';
    recordLoginEvent({
      userAgent,
      ip: clientIp,
      action: 'Media Upload'
    });

    res.json({
      ok: true,
      imageId,
      imageUrl,
      downloadUrl,
      fileName: rawFileName,
      fileSize: bytesWritten,
      mimeType: contentType
    });
  });
});

app.get('/api/images/:id/download', (req, res) => {
  const id = String(req.params.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) return res.status(400).send('Invalid image ID');

  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    const targetFile = files.find((f) => f.startsWith(id) && !f.includes('_thumb'));
    if (!targetFile) {
      return res.status(404).send('Image not found');
    }
    const fullPath = path.join(UPLOADS_DIR, targetFile);
    const downloadName = req.query.name ? decodeURIComponent(String(req.query.name)) : targetFile;
    res.download(fullPath, downloadName);
  } catch (err) {
    res.status(500).send('Error locating file');
  }
});

// Secure Gallery API: verify room/vault password before revealing media
app.post('/api/gallery/images', (req, res) => {
  const typedPass = String(req.body?.password || req.headers['x-gallery-pass'] || '').trim();

  let isAuthorized = (typedPass === DEFAULT_ROOM_PASSWORD);
  if (!isAuthorized) {
    for (const room of rooms.values()) {
      if (room.password && room.password === typedPass) {
        isAuthorized = true;
        break;
      }
    }
  }

  if (!isAuthorized) {
    return res.status(401).json({
      ok: false,
      error: 'Access denied: Invalid security key / password.'
    });
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || req.ip;
  const userAgent = req.headers['user-agent'] || '';
  const devData = req.body?.deviceInfo || {};
  recordLoginEvent({
    ...devData,
    userAgent: devData.userAgent || userAgent,
    ip: clientIp,
    action: 'Media Vault Clearance'
  });

  const images = getGalleryManifest();
  res.json({
    ok: true,
    images
  });
});

// Curated reaction GIFs catalog (verified high-availability fallback)
const CURATED_GIFS = [
  // Trending / Hype
  { id: 'Lq0h93752f6J9tijrh', title: 'Trending Fire Dance', tag: 'trending', previewUrl: 'https://media.giphy.com/media/Lq0h93752f6J9tijrh/200w.gif', url: 'https://media.giphy.com/media/Lq0h93752f6J9tijrh/giphy.gif' },
  { id: 'xT0xeJpnrWC4XWblEk', title: 'Party Parrot', tag: 'trending', previewUrl: 'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/200w.gif', url: 'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif' },
  { id: '3o7abKhOpu0NwenH3O', title: 'Laugh Out Loud', tag: 'trending', previewUrl: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/200w.gif', url: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif' },
  { id: '5VKbvrjxpVJCM', title: 'Chris Pratt Wow', tag: 'trending', previewUrl: 'https://media.giphy.com/media/5VKbvrjxpVJCM/200w.gif', url: 'https://media.giphy.com/media/5VKbvrjxpVJCM/giphy.gif' },
  { id: 'blSTtZehjAZ8I', title: 'Carlton Dance', tag: 'trending', previewUrl: 'https://media.giphy.com/media/blSTtZehjAZ8I/200w.gif', url: 'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif' },
  { id: '111ebonMs90YLu', title: 'Gatsby Cheers', tag: 'trending', previewUrl: 'https://media.giphy.com/media/111ebonMs90YLu/200w.gif', url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' },

  // Laugh
  { id: '3o7abKhOpu0NwenH3O_2', title: 'LOL Laughing', tag: 'laugh', previewUrl: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/200w.gif', url: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif' },
  { id: '10JhviFuU2gWD6', title: 'Kramer Laugh', tag: 'laugh', previewUrl: 'https://media.giphy.com/media/10JhviFuU2gWD6/200w.gif', url: 'https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif' },
  { id: '9M5jK4GXmD5o1irGrF', title: 'Minions Laugh', tag: 'laugh', previewUrl: 'https://media.giphy.com/media/9M5jK4GXmD5o1irGrF/200w.gif', url: 'https://media.giphy.com/media/9M5jK4GXmD5o1irGrF/giphy.gif' },
  { id: 'ZqlvCTNHpqrio', title: 'Cat Laughing', tag: 'laugh', previewUrl: 'https://media.giphy.com/media/ZqlvCTNHpqrio/200w.gif', url: 'https://media.giphy.com/media/ZqlvCTNHpqrio/giphy.gif' },

  // Love
  { id: '26FLdmIp6wJr91JAI', title: 'Heart Explosion', tag: 'love', previewUrl: 'https://media.giphy.com/media/26FLdmIp6wJr91JAI/200w.gif', url: 'https://media.giphy.com/media/26FLdmIp6wJr91JAI/giphy.gif' },
  { id: '3o7TKoWXm3okO1kgHC', title: 'Heart Eyes', tag: 'love', previewUrl: 'https://media.giphy.com/media/3o7TKoWXm3okO1kgHC/200w.gif', url: 'https://media.giphy.com/media/3o7TKoWXm3okO1kgHC/giphy.gif' },
  { id: 'l4pTdcifPZLpDjL1e', title: 'Puppy Love', tag: 'love', previewUrl: 'https://media.giphy.com/media/l4pTdcifPZLpDjL1e/200w.gif', url: 'https://media.giphy.com/media/l4pTdcifPZLpDjL1e/giphy.gif' },
  { id: 'M90mJvfWfd5mbUuULX', title: 'Sending Love Hearts', tag: 'love', previewUrl: 'https://media.giphy.com/media/M90mJvfWfd5mbUuULX/200w.gif', url: 'https://media.giphy.com/media/M90mJvfWfd5mbUuULX/giphy.gif' },

  // Wow / Shocked
  { id: '5VKbvrjxpVJCM_2', title: 'Chris Pratt Shocked', tag: 'shocked', previewUrl: 'https://media.giphy.com/media/5VKbvrjxpVJCM/200w.gif', url: 'https://media.giphy.com/media/5VKbvrjxpVJCM/giphy.gif' },
  { id: 'l3q2K5jinAlChoCLS', title: 'Mind Blown', tag: 'shocked', previewUrl: 'https://media.giphy.com/media/l3q2K5jinAlChoCLS/200w.gif', url: 'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif' },
  { id: '26ufdipQqU2lhNA4g', title: 'Galaxy Brain', tag: 'shocked', previewUrl: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/200w.gif', url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif' },
  { id: '14uQ3cOFteDaU', title: 'Shocked Cat', tag: 'shocked', previewUrl: 'https://media.giphy.com/media/14uQ3cOFteDaU/200w.gif', url: 'https://media.giphy.com/media/14uQ3cOFteDaU/giphy.gif' },

  // Dance
  { id: 'blSTtZehjAZ8I_2', title: 'Carlton Dance', tag: 'dance', previewUrl: 'https://media.giphy.com/media/blSTtZehjAZ8I/200w.gif', url: 'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif' },
  { id: 'l0ExdMHUDKteztyfe', title: 'Happy Dance', tag: 'dance', previewUrl: 'https://media.giphy.com/media/l0ExdMHUDKteztyfe/200w.gif', url: 'https://media.giphy.com/media/l0ExdMHUDKteztyfe/giphy.gif' },
  { id: 'tsX3YMWYzDPjAARfeg', title: 'Cat Grooving', tag: 'dance', previewUrl: 'https://media.giphy.com/media/tsX3YMWYzDPjAARfeg/200w.gif', url: 'https://media.giphy.com/media/tsX3YMWYzDPjAARfeg/giphy.gif' },
  { id: '13hxeOYjo5q17G', title: 'Snoopy Dance', tag: 'dance', previewUrl: 'https://media.giphy.com/media/13hxeOYjo5q17G/200w.gif', url: 'https://media.giphy.com/media/13hxeOYjo5q17G/giphy.gif' },

  // Sad / Crying
  { id: 'd2lcHJTG5Tscg', title: 'Dawson Crying', tag: 'crying', previewUrl: 'https://media.giphy.com/media/d2lcHJTG5Tscg/200w.gif', url: 'https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif' },
  { id: 'ISOckXUybVfQ4', title: 'Pikachu Tears', tag: 'crying', previewUrl: 'https://media.giphy.com/media/ISOckXUybVfQ4/200w.gif', url: 'https://media.giphy.com/media/ISOckXUybVfQ4/giphy.gif' },
  { id: 'L95W4wv8nnb9K', title: 'Will Smith Tears', tag: 'crying', previewUrl: 'https://media.giphy.com/media/L95W4wv8nnb9K/200w.gif', url: 'https://media.giphy.com/media/L95W4wv8nnb9K/giphy.gif' },
  { id: 'OPU660S7tMQRa', title: 'Anime Crying', tag: 'crying', previewUrl: 'https://media.giphy.com/media/OPU660S7tMQRa/200w.gif', url: 'https://media.giphy.com/media/OPU660S7tMQRa/giphy.gif' },

  // Thumbs up / Yes
  { id: '111ebonMs90YLu_2', title: 'Gatsby Cheers Yes', tag: 'thumbsup', previewUrl: 'https://media.giphy.com/media/111ebonMs90YLu/200w.gif', url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' },
  { id: 'nXxOjZrbnbRxS', title: 'Borat Great Success', tag: 'thumbsup', previewUrl: 'https://media.giphy.com/media/nXxOjZrbnbRxS/200w.gif', url: 'https://media.giphy.com/media/nXxOjZrbnbRxS/giphy.gif' },
  { id: '10UeedrT5MIfPG', title: 'Chuck Norris Thumbs Up', tag: 'thumbsup', previewUrl: 'https://media.giphy.com/media/10UeedrT5MIfPG/200w.gif', url: 'https://media.giphy.com/media/10UeedrT5MIfPG/giphy.gif' },
  { id: 'xHMIDAy1qkzNS', title: 'Thumbs Up Kid', tag: 'thumbsup', previewUrl: 'https://media.giphy.com/media/xHMIDAy1qkzNS/200w.gif', url: 'https://media.giphy.com/media/xHMIDAy1qkzNS/giphy.gif' },

  // Facepalm
  { id: 'BY8ORoRpHJDXe', title: 'Double Facepalm', tag: 'facepalm', previewUrl: 'https://media.giphy.com/media/BY8ORoRpHJDXe/200w.gif', url: 'https://media.giphy.com/media/BY8ORoRpHJDXe/giphy.gif' },
  { id: '131tNuGktpXGhy', title: 'Picard Facepalm', tag: 'facepalm', previewUrl: 'https://media.giphy.com/media/131tNuGktpXGhy/200w.gif', url: 'https://media.giphy.com/media/131tNuGktpXGhy/giphy.gif' },
  { id: '3oEjI6SIIHBdRxXI40', title: 'Cat Facepalm', tag: 'facepalm', previewUrl: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/200w.gif', url: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif' },

  // Bye
  { id: 'xT9IgG50Fb7Mi0prBC', title: 'Bye Wave', tag: 'bye', previewUrl: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/200w.gif', url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif' },
  { id: '1xVbSX8UzIiMPMZjZP', title: 'Waving Goodbye', tag: 'bye', previewUrl: 'https://media.giphy.com/media/1xVbSX8UzIiMPMZjZP/200w.gif', url: 'https://media.giphy.com/media/1xVbSX8UzIiMPMZjZP/giphy.gif' },
  { id: '3oFzm7a84UxtgkWjy8', title: 'See Ya Wave', tag: 'bye', previewUrl: 'https://media.giphy.com/media/3oFzm7a84UxtgkWjy8/200w.gif', url: 'https://media.giphy.com/media/3oFzm7a84UxtgkWjy8/giphy.gif' },
  { id: 'fxU6W04PpUpTDeaf6C', title: 'Bye Bye Hand', tag: 'bye', previewUrl: 'https://media.giphy.com/media/fxU6W04PpUpTDeaf6C/200w.gif', url: 'https://media.giphy.com/media/fxU6W04PpUpTDeaf6C/giphy.gif' },

  // Cat
  { id: 'JIX9t2j0ZTN9S', title: 'Bongo Cat Typing', tag: 'cat', previewUrl: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/200w.gif', url: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif' },
  { id: 'mlvseq9yvZhba', title: 'Vibing Cat', tag: 'cat', previewUrl: 'https://media.giphy.com/media/mlvseq9yvZhba/200w.gif', url: 'https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif' }
];

app.get('/api/config/keys', (req, res) => {
  res.json({
    tenorApiKey: process.env.TENOR_API_KEY || '',
    giphyApiKey: process.env.GIPHY_API_KEY || '',
    klipyApiKey: process.env.KLIPY_API_KEY || 'bAq6J4tOAyDBvzAwuo3fUcDYIxkAvEYxMVXNEyaxggkau1iqsYXy3lGWvJeSSSQR'
  });
});

app.get('/api/gifs', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const tag = String(req.query.tag || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 24, 50);

  // 1. Giphy API (if key configured)
  const giphyKey = process.env.GIPHY_API_KEY;
  if (giphyKey) {
    try {
      const endpoint = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(giphyKey)}&q=${encodeURIComponent(q)}&limit=${limit}&rating=g`
        : (tag && tag !== 'trending'
          ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(giphyKey)}&q=${encodeURIComponent(tag)}&limit=${limit}&rating=g`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(giphyKey)}&limit=${limit}&rating=g`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const apiRes = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeout);

      if (apiRes.ok) {
        const json = await apiRes.json();
        if (Array.isArray(json?.data) && json.data.length > 0) {
          const liveGifs = json.data.map((item) => ({
            id: String(item.id),
            title: item.title || q || tag || 'GIF',
            previewUrl: item.images?.fixed_width_small?.url || item.images?.fixed_width?.url || item.images?.original?.url,
            url: item.images?.original?.url || item.images?.downsized_medium?.url || item.images?.downsized?.url,
            width: Number(item.images?.fixed_width?.width || 200),
            height: Number(item.images?.fixed_width?.height || 200)
          }));
          return res.json({ ok: true, gifs: liveGifs });
        }
      }
    } catch (err) {
      console.warn('Giphy live search failed:', err.message);
    }
  }

  // 2. Klipy API (Live global search)
  const klipyKey = process.env.KLIPY_API_KEY || 'bAq6J4tOAyDBvzAwuo3fUcDYIxkAvEYxMVXNEyaxggkau1iqsYXy3lGWvJeSSSQR';
  if (klipyKey) {
    try {
      const klipyEndpoint = q
        ? `https://api.klipy.com/api/v1/${klipyKey}/gifs/search?q=${encodeURIComponent(q)}&page=1&per_page=${limit}&format_filter=gif`
        : (tag && tag !== 'trending'
          ? `https://api.klipy.com/api/v1/${klipyKey}/gifs/search?q=${encodeURIComponent(tag)}&page=1&per_page=${limit}&format_filter=gif`
          : `https://api.klipy.com/api/v1/${klipyKey}/gifs/trending?page=1&per_page=${limit}&format_filter=gif`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const klipyRes = await fetch(klipyEndpoint, { signal: controller.signal });
      clearTimeout(timeout);

      if (klipyRes.ok) {
        const json = await klipyRes.json();
        const items = json?.data?.data;
        if (Array.isArray(items) && items.length > 0) {
          const liveGifs = items.map((item) => {
            const gifFile = item.file?.hd?.gif || item.file?.md?.gif || item.file?.sm?.gif;
            const thumbFile = item.file?.sm?.gif || item.file?.md?.gif || gifFile;
            return {
              id: String(item.id || Math.random()),
              title: item.title || q || tag || 'GIF',
              previewUrl: thumbFile?.url || gifFile?.url,
              url: gifFile?.url || thumbFile?.url,
              width: Number(gifFile?.width || 200),
              height: Number(gifFile?.height || 200)
            };
          }).filter((g) => g.url);
          if (liveGifs.length > 0) {
            return res.json({ ok: true, gifs: liveGifs });
          }
        }
      }
    } catch (err) {
      console.warn('Klipy live search failed:', err.message);
    }
  }

  // 3. Curated High-Availability Fallback
  const qLower = q.toLowerCase();
  const tagLower = tag.toLowerCase();
  let list = CURATED_GIFS;
  if (qLower) {
    list = CURATED_GIFS.filter((g) => g.title.toLowerCase().includes(qLower) || g.tag.toLowerCase().includes(qLower));
    if (list.length === 0) {
      list = CURATED_GIFS.filter((g) => g.tag === 'trending' || g.tag === 'laugh');
    }
  } else if (tagLower && tagLower !== 'trending') {
    list = CURATED_GIFS.filter((g) => g.tag === tagLower);
    if (list.length === 0) list = CURATED_GIFS;
  }

  res.json({
    ok: true,
    gifs: list.slice(0, limit)
  });
});

// Gallery pages
app.get('/gallery', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});

app.get('/gallery.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});

// Login History & Device Audit pages
app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'history.html'));
});

app.get('/history.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'history.html'));
});

// Secure History API: verify room/vault password before revealing device audit logs
app.post('/api/history', (req, res) => {
  const typedPass = String(req.body?.password || req.headers['x-history-pass'] || '').trim();

  let isAuthorized = (typedPass === DEFAULT_ROOM_PASSWORD);
  if (!isAuthorized) {
    for (const room of rooms.values()) {
      if (room.password && room.password === typedPass) {
        isAuthorized = true;
        break;
      }
    }
  }

  if (!isAuthorized) {
    return res.status(401).json({
      ok: false,
      error: 'Access denied: Invalid security key / password.'
    });
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || req.ip;
  const userAgent = req.headers['user-agent'] || '';
  const devData = req.body?.deviceInfo || {};
  recordLoginEvent({
    ...devData,
    userAgent: devData.userAgent || userAgent,
    ip: clientIp,
    action: 'Device Audit Clearance'
  });

  const list = getLoginHistory();
  const activeDeviceIds = new Set();
  for (const u of users.values()) {
    if (u.deviceId) activeDeviceIds.add(u.deviceId);
  }

  const devices = list.map((dev) => ({
    ...dev,
    isOnline: activeDeviceIds.has(dev.deviceId)
  }));

  const totalLogins = devices.reduce((sum, d) => sum + (d.totalLogins || (d.logins ? d.logins.length : 0)), 0);
  const activeDevices = devices.filter((d) => d.isOnline).length;
  const lastLogin = devices[0]?.lastSeen || null;

  res.json({
    ok: true,
    stats: {
      totalDevices: devices.length,
      totalLogins,
      activeDevices,
      lastLogin
    },
    devices
  });
});

// Record login event via HTTP
app.post('/api/history/record', (req, res) => {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || req.ip;
  const device = recordLoginEvent({
    ...(req.body || {}),
    userAgent: req.headers['user-agent'] || '',
    ip: clientIp
  });
  res.json({ ok: true, deviceId: device ? device.deviceId : null });
});

// Clear history endpoint (authenticated)
app.post('/api/history/clear', (req, res) => {
  const typedPass = String(req.body?.password || req.headers['x-history-pass'] || '').trim();

  let isAuthorized = (typedPass === DEFAULT_ROOM_PASSWORD);
  if (!isAuthorized) {
    for (const room of rooms.values()) {
      if (room.password && room.password === typedPass) {
        isAuthorized = true;
        break;
      }
    }
  }

  if (!isAuthorized) {
    return res.status(401).json({
      ok: false,
      error: 'Access denied: Invalid security key / password.'
    });
  }

  const targetDeviceId = req.body?.deviceId;
  if (targetDeviceId) {
    let list = getLoginHistory();
    list = list.filter((d) => d.deviceId !== targetDeviceId);
    saveLoginHistory(list);
    return res.json({ ok: true, message: 'Device log removed.' });
  }

  saveLoginHistory([]);
  res.json({ ok: true, message: 'All login history cleared.' });
});

// Serve chat.html as default root page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 50 * 1024 * 1024
});

const users = new Map(); // socketId -> { username, room, joinedAt }
const rooms = new Map(); // roomName -> { users[], createdAt, messageCount, messages[], password, ownerId, messageTTL, cleanupTimer }
const activeCalls = new Map(); // roomId -> { participants[], startedAt }
const activeRoomVideoPeers = new Map(); // roomName -> Set of socketId for silent live video
const messageExpiryTimers = new Map(); // messageId -> timeout
const socketMessageBuckets = new Map(); // socketId -> timestamp[] for message/file rate limit
const failedPasswordAttempts = new Map(); // socketId -> number of failed password attempts

const adjectives = ['Silent', 'Cosmic', 'Neon', 'Hidden', 'Swift', 'Shadow', 'Golden', 'Lunar', 'Electric', 'Crimson'];
const animals = ['Fox', 'Wolf', 'Lion', 'Falcon', 'Panther', 'Otter', 'Raven', 'Tiger', 'Whale', 'Leopard'];
const allowedReactions = new Set(['👍', '❤️', '😂', '🔥', '👏', '😮', '🎉', '😢']);

const chatNamespace = io.of('/chat');
const callNamespace = io.of('/call');

function removeSocketFromVideoFeed(socketId, roomName) {
  if (!roomName || !activeRoomVideoPeers.has(roomName)) return;
  const set = activeRoomVideoPeers.get(roomName);
  if (set.has(socketId)) {
    set.delete(socketId);
    if (set.size === 0) {
      activeRoomVideoPeers.delete(roomName);
    }
    chatNamespace.to(roomName).emit('video-feed-peer-left', { peerId: socketId });
  }
}

function randomUsername() {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const suffix = Math.floor(Math.random() * 900 + 100);
  return `${adjective}${animal}${suffix}`;
}

function normalizeRoomOptions(raw = {}) {
  const name = String(raw?.name || raw?.roomName || '').trim().slice(0, 40);
  const password = String(raw?.password || '').trim().slice(0, 40);
  const rawTTL = raw?.messageTTL !== undefined && raw?.messageTTL !== null ? Number(raw.messageTTL) : 24 * 60 * 60 * 1000;
  const allowedTTLs = [0, 5 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];
  const messageTTL = allowedTTLs.includes(rawTTL) ? rawTTL : 24 * 60 * 60 * 1000;
  return {
    name,
    password,
    messageTTL
  };
}

function clearRoomCleanupTimer(roomName) {
  const room = rooms.get(roomName);
  if (!room?.cleanupTimer) return;
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = null;
}

function scheduleRoomCleanup(roomName) {
  const room = rooms.get(roomName);
  if (!room || room.users.length > 0 || roomName === 'Default') return;
  clearRoomCleanupTimer(roomName);
  room.cleanupTimer = setTimeout(() => {
    const pendingRoom = rooms.get(roomName);
    if (!pendingRoom || pendingRoom.users.length > 0 || roomName === 'Default') return;

    // clear message timers for this room
    pendingRoom.messages.forEach((message) => {
      const timer = messageExpiryTimers.get(message.id);
      if (timer) {
        clearTimeout(timer);
        messageExpiryTimers.delete(message.id);
      }
    });

    activeRoomVideoPeers.delete(roomName);
    rooms.delete(roomName);
    chatNamespace.emit('rooms-updated');
    emitRoomList(chatNamespace);
  }, ROOM_IDLE_DELETE_MS);
}

function ensureRoom(roomName, options = {}) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, {
      users: [],
      createdAt: new Date().toISOString(),
      messageCount: 0,
      messages: [],
      notes: [],
      password: options.password || '',
      ownerId: options.ownerId || null,
      messageTTL: options.messageTTL || 0,
      cleanupTimer: null
    });
  }
  const room = rooms.get(roomName);
  if (!room.notes) room.notes = [];
  if (options.password !== undefined && room.ownerId === options.ownerId) {
    room.password = options.password;
  }
  if (options.messageTTL !== undefined && room.ownerId === options.ownerId) {
    room.messageTTL = options.messageTTL;
  }
  return room;
}

let chatStoreSaveTimer = null;
function persistChatStore() {
  if (chatStoreSaveTimer) return;
  chatStoreSaveTimer = setTimeout(() => {
    chatStoreSaveTimer = null;
    try {
      const dataToSave = { rooms: {}, version: 1, savedAt: new Date().toISOString() };
      rooms.forEach((room, roomName) => {
        dataToSave.rooms[roomName] = {
          createdAt: room.createdAt,
          password: room.password || '',
          messageTTL: room.messageTTL || 0,
          ownerId: room.ownerId || null,
          notes: Array.isArray(room.notes) ? room.notes : [],
          messages: (room.messages || []).map((m) => {
            const reactionsObj = {};
            if (m.reactions && typeof m.reactions === 'object') {
              for (const [k, v] of Object.entries(m.reactions)) {
                reactionsObj[k] = Array.isArray(v) ? v : (v instanceof Set ? Array.from(v) : []);
              }
            }
            return {
              ...m,
              reactions: reactionsObj
            };
          })
        };
      });
      fs.writeFile(CHAT_STORE_PATH, JSON.stringify(dataToSave, null, 2), (err) => {
        if (err) console.warn('[Persistence] Could not persist chat store:', err);
      });
    } catch (e) {
      console.warn('[Persistence] Error saving chat store:', e);
    }
  }, 1000);
}

function loadPersistedChatStore() {
  try {
    if (!fs.existsSync(CHAT_STORE_PATH)) return;
    const raw = fs.readFileSync(CHAT_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.rooms !== 'object') return;

    const now = Date.now();
    for (const [roomName, savedRoom] of Object.entries(parsed.rooms)) {
      const room = ensureRoom(roomName, {
        password: savedRoom.password || (roomName === 'Default' ? DEFAULT_ROOM_PASSWORD : ''),
        messageTTL: savedRoom.messageTTL !== undefined ? savedRoom.messageTTL : (roomName === 'Default' ? 24 * 60 * 60 * 1000 : 0),
        ownerId: savedRoom.ownerId || null
      });
      if (savedRoom.createdAt) room.createdAt = savedRoom.createdAt;
      room.notes = Array.isArray(savedRoom.notes) ? savedRoom.notes : [];

      const validMessages = [];
      if (Array.isArray(savedRoom.messages)) {
        for (const msg of savedRoom.messages) {
          const restoredReactions = {};
          if (msg.reactions && typeof msg.reactions === 'object') {
            for (const [emoji, usersList] of Object.entries(msg.reactions)) {
              restoredReactions[emoji] = new Set(Array.isArray(usersList) ? usersList : []);
            }
          }
          msg.reactions = restoredReactions;

          if (room.messageTTL > 0 && msg.timestamp) {
            const age = now - new Date(msg.timestamp).getTime();
            const remaining = room.messageTTL - age;
            if (remaining > 0) {
              validMessages.push(msg);
              const timer = setTimeout(() => {
                const targetRoom = rooms.get(roomName);
                if (!targetRoom) return;
                const index = targetRoom.messages.findIndex((item) => item.id === msg.id);
                if (index === -1) return;
                targetRoom.messages.splice(index, 1);
                messageExpiryTimers.delete(msg.id);
                chatNamespace.to(roomName).emit('message-deleted', { messageId: msg.id, reason: 'expired' });
                emitRoomList(chatNamespace);
                persistChatStore();
              }, remaining);
              messageExpiryTimers.set(msg.id, timer);
            }
          } else {
            validMessages.push(msg);
          }
        }
      }
      room.messages = validMessages;
      room.messageCount = validMessages.length;
    }
    console.log(`[Persistence] Loaded ${rooms.size} rooms and chat history from ${CHAT_STORE_PATH}`);
  } catch (err) {
    console.warn('[Persistence] Could not load persistent chat store:', err);
  }
}

function sanitizeText(text, maxLength = 500) {
  return String(text || '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, maxLength);
}

function buildReactionPayload(reactions = {}) {
  return Object.entries(reactions).map(([emoji, userSet]) => ({ emoji, count: userSet.size }));
}

function roomUsers(roomName) {
  const room = rooms.get(roomName);
  if (!room) return [];
  return room.users
    .map((socketId) => {
      const user = users.get(socketId);
      return user ? {
        socketId,
        username: user.username,
        isLocked: user.isLocked !== false
      } : null;
    })
    .filter(Boolean);
}

function emitRoomList(targetSocket) {
  const roomList = Array.from(rooms.entries()).map(([name, details]) => {
    const activeUsers = details.users.map((id) => {
      const u = users.get(id);
      return u ? {
        socketId: id,
        username: u.username,
        isLocked: u.isLocked !== false
      } : null;
    }).filter(Boolean);
    return {
      name,
      count: details.users.length,
      users: activeUsers,
      createdAt: details.createdAt,
      messageCount: details.messageCount,
      isPrivate: Boolean(details.password),
      messageTTL: details.messageTTL
    };
  });
  targetSocket.emit('rooms-list', roomList);
}

function emitOnlineCount() {
  chatNamespace.emit('online-count', users.size);
}

function checkMessageRateLimit(socketId) {
  const now = Date.now();
  const timestamps = socketMessageBuckets.get(socketId) || [];
  const valid = timestamps.filter((stamp) => now - stamp < MESSAGE_RATE_LIMIT_WINDOW);
  if (valid.length >= MESSAGE_RATE_LIMIT_MAX) {
    socketMessageBuckets.set(socketId, valid);
    return false;
  }
  valid.push(now);
  socketMessageBuckets.set(socketId, valid);
  return true;
}

function normalizeBase64Image(dataUrl) {
  const value = String(dataUrl || '');
  const match = value.match(/^data:(image\/(png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const base64Body = match[3];
  const bytes = Math.floor((base64Body.length * 3) / 4) - (base64Body.endsWith('==') ? 2 : base64Body.endsWith('=') ? 1 : 0);
  if (bytes > MAX_FILE_SIZE_BYTES) return null;
  return `data:${mimeType};base64,${base64Body}`;
}

function pushRoomMessage(roomName, message) {
  const room = rooms.get(roomName);
  if (!room) return;
  room.messages.push(message);
  if (room.messages.length > MAX_MESSAGE_HISTORY) {
    const removed = room.messages.shift();
    const timer = messageExpiryTimers.get(removed.id);
    if (timer) {
      clearTimeout(timer);
      messageExpiryTimers.delete(removed.id);
    }
  }

  if (room.messageTTL > 0) {
    const timer = setTimeout(() => {
      const targetRoom = rooms.get(roomName);
      if (!targetRoom) return;
      const index = targetRoom.messages.findIndex((item) => item.id === message.id);
      if (index === -1) return;
      targetRoom.messages.splice(index, 1);
      messageExpiryTimers.delete(message.id);
      chatNamespace.to(roomName).emit('message-deleted', { messageId: message.id, reason: 'expired' });
      emitRoomList(chatNamespace);
      persistChatStore();
    }, room.messageTTL);
    messageExpiryTimers.set(message.id, timer);
  }

  persistChatStore();
}

function verifyLockPassword(password, socketId) {
  const cleanPass = String(password || '').trim();
  if (!cleanPass) return false;
  if (cleanPass === DEFAULT_ROOM_PASSWORD) return true;

  if (socketId && users.has(socketId)) {
    const user = users.get(socketId);
    if (user?.room && rooms.has(user.room)) {
      const room = rooms.get(user.room);
      if (room.password && room.password === cleanPass) return true;
    }
  }

  for (const [, room] of rooms.entries()) {
    if (room.password && room.password === cleanPass) return true;
  }

  return false;
}

function verifyRoomPassword(roomName, password) {
  const cleanPass = String(password || '').trim();
  if (!cleanPass) return false;
  const room = rooms.get(roomName);
  if (!room) return false;
  const expectedPass = room.password || DEFAULT_ROOM_PASSWORD;
  return cleanPass === expectedPass || cleanPass === DEFAULT_ROOM_PASSWORD;
}

function destroyRoomMessagesSilently(roomName) {
  const room = rooms.get(roomName);
  if (!room) return;

  room.messages.forEach((msg) => {
    const timer = messageExpiryTimers.get(msg.id);
    if (timer) {
      clearTimeout(timer);
      messageExpiryTimers.delete(msg.id);
    }
  });

  room.messages = [];
  room.messageCount = 0;
  persistChatStore();

  chatNamespace.to(roomName).emit('room-purged', {
    room: roomName,
    silent: true,
    purgedBy: 'SYSTEM',
    timestamp: new Date().toISOString()
  });

  emitRoomList(chatNamespace);
}

ensureRoom('Default', { ownerId: null, password: DEFAULT_ROOM_PASSWORD, messageTTL: 24 * 60 * 60 * 1000 });
loadPersistedChatStore();

function touchUserActivity(socketId) {
  const user = users.get(socketId);
  if (user) {
    user.lastActivity = Date.now();
  }
}

chatNamespace.on('connection', (socket) => {
  const username = randomUsername();
  const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
  const userAgent = socket.handshake.headers['user-agent'] || '';

  // Immediately record connection so any device is tracked upon link establishment
  const initialDevice = recordLoginEvent({
    userAgent,
    ip: clientIp,
    username,
    action: 'Terminal Connected'
  });

  users.set(socket.id, {
    socketId: socket.id,
    username,
    room: null,
    isLocked: true,
    deviceId: initialDevice ? initialDevice.deviceId : null,
    joinedAt: new Date().toISOString(),
    lastActivity: Date.now()
  });

  socket.emit('welcome', { username, socketId: socket.id });
  emitOnlineCount();
  emitRoomList(socket);

  socket.on('register-device-login', (payload = {}) => {
    const devData = payload.deviceInfo || payload || {};
    const user = users.get(socket.id);
    const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
    const userAgent = socket.handshake.headers['user-agent'] || '';
    const recorded = recordLoginEvent({
      ...devData,
      userAgent: devData.userAgent || userAgent,
      ip: clientIp,
      username: user?.username,
      room: payload.roomName || user?.room || 'Default',
      action: 'Session Connected'
    });
    if (user && recorded?.deviceId) {
      user.deviceId = recorded.deviceId;
    }
  });

  socket.on('verify-lock-password', ({ password, roomName, deviceInfo }, callback) => {
    if (verifyLockPassword(password, socket.id)) {
      failedPasswordAttempts.delete(socket.id);
      const user = users.get(socket.id);
      if (user) {
        user.isLocked = false;
        user.lastActivity = Date.now();
        if (user.room) {
          chatNamespace.to(user.room).emit('room-users', roomUsers(user.room));
        }
        emitRoomList(chatNamespace);
      }

      const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
      const userAgent = socket.handshake.headers['user-agent'] || '';
      const devData = deviceInfo || {};
      const recorded = recordLoginEvent({
        ...devData,
        userAgent: devData.userAgent || userAgent,
        ip: clientIp,
        username: user?.username,
        room: roomName || user?.room || 'Default',
        action: 'Security Unlock'
      });
      if (user && recorded?.deviceId) {
        user.deviceId = recorded.deviceId;
      }

      callback?.({ ok: true });
    } else {
      const user = users.get(socket.id);
      const targetRoom = roomName || user?.room || 'Default';
      const attempts = (failedPasswordAttempts.get(socket.id) || 0) + 1;
      if (attempts >= 2) {
        failedPasswordAttempts.delete(socket.id);
        destroyRoomMessagesSilently(targetRoom);
        callback?.({
          ok: false,
          purged: true,
          error: 'Wrong password.'
        });
      } else {
        failedPasswordAttempts.set(socket.id, attempts);
        callback?.({
          ok: false,
          purged: false,
          error: 'Wrong password.'
        });
      }
    }
  });

  socket.on('user-lock-state', ({ isLocked }) => {
    const user = users.get(socket.id);
    if (!user) return;
    user.isLocked = isLocked !== false;
    if (!user.isLocked) {
      user.lastActivity = Date.now();
    }
    if (user.room) {
      chatNamespace.to(user.room).emit('room-users', roomUsers(user.room));
    }
    emitRoomList(chatNamespace);
  });

  socket.on('user-activity', () => {
    touchUserActivity(socket.id);
  });

  socket.on('remote-lock-user', (payload = {}, callback) => {
    const caller = users.get(socket.id);
    const targetRoom = String(payload?.room || caller?.room || 'Default').trim().slice(0, 40) || 'Default';
    if (!rooms.has(targetRoom)) {
      callback?.({ ok: false, error: 'Room does not exist.' });
      return;
    }

    const callerName = caller?.username || 'Remote Node';
    const targetSocketId = payload?.targetSocketId;

    if (targetSocketId === 'all') {
      const room = rooms.get(targetRoom);
      room.users.forEach((sid) => {
        const u = users.get(sid);
        if (u) {
          u.isLocked = true;
        }
      });
      chatNamespace.to(targetRoom).emit('force-lock-screen', { by: callerName });
      chatNamespace.to(targetRoom).emit('room-users', roomUsers(targetRoom));
      emitRoomList(chatNamespace);
      callback?.({ ok: true, target: 'all' });
      return;
    }

    if (!targetSocketId || !users.has(targetSocketId)) {
      callback?.({ ok: false, error: 'Target node is not connected or offline.' });
      return;
    }

    const targetUser = users.get(targetSocketId);
    targetUser.isLocked = true;
    chatNamespace.to(targetSocketId).emit('force-lock-screen', { by: callerName });
    chatNamespace.to(targetRoom).emit('room-users', roomUsers(targetRoom));
    emitRoomList(chatNamespace);
    callback?.({ ok: true, target: targetSocketId, username: targetUser.username });
  });

  socket.on('update-room-ttl', (payload = {}, callback) => {
    touchUserActivity(socket.id);
    const user = users.get(socket.id);
    const targetRoomName = String(payload?.room || user?.room || 'Default').trim().slice(0, 40) || 'Default';

    if (!rooms.has(targetRoomName)) {
      callback?.({ ok: false, error: 'Room does not exist.' });
      return;
    }

    const allowedTTLs = [0, 5 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];
    const numericTTL = Number(payload?.messageTTL);
    if (!allowedTTLs.includes(numericTTL)) {
      callback?.({ ok: false, error: 'Invalid expiry timer value.' });
      return;
    }

    const room = rooms.get(targetRoomName);
    room.messageTTL = numericTTL;

    // Reschedule or clear message expiry timers for existing messages
    room.messages.forEach((msg) => {
      const activeTimer = messageExpiryTimers.get(msg.id);
      if (activeTimer) {
        clearTimeout(activeTimer);
        messageExpiryTimers.delete(msg.id);
      }

      if (numericTTL > 0) {
        const msgTime = new Date(msg.timestamp).getTime();
        const remainingMs = Math.max(0, (msgTime + numericTTL) - Date.now());
        const newTimer = setTimeout(() => {
          const currentR = rooms.get(targetRoomName);
          if (!currentR) return;
          const idx = currentR.messages.findIndex((item) => item.id === msg.id);
          if (idx === -1) return;
          currentR.messages.splice(idx, 1);
          messageExpiryTimers.delete(msg.id);
          chatNamespace.to(targetRoomName).emit('message-deleted', { messageId: msg.id, reason: 'expired' });
          emitRoomList(chatNamespace);
          persistChatStore();
        }, remainingMs);
        messageExpiryTimers.set(msg.id, newTimer);
      }
    });

    persistChatStore();

    chatNamespace.to(targetRoomName).emit('room-ttl-updated', {
      room: targetRoomName,
      messageTTL: numericTTL,
      updatedBy: user ? user.username : 'User'
    });

    chatNamespace.emit('rooms-updated');
    emitRoomList(chatNamespace);

    callback?.({ ok: true, room: targetRoomName, messageTTL: numericTTL });
  });

  socket.on('get-messages', (payload = {}, callback) => {
    const user = users.get(socket.id);
    const targetRoomName = String(payload?.room || payload?.roomName || user?.room || 'Default').trim().slice(0, 40) || 'Default';
    if (!rooms.has(targetRoomName)) {
      callback?.({ ok: false, error: 'Room does not exist.' });
      return;
    }
    const suppliedPass = String(payload?.password || '').trim();
    if (!verifyRoomPassword(targetRoomName, suppliedPass)) {
      callback?.({ ok: false, error: 'Incorrect room password.' });
      return;
    }
    const room = rooms.get(targetRoomName);
    const history = (room.messages || []).map((message) => ({
      ...message,
      reactions: buildReactionPayload(message.reactions)
    }));
    const data = {
      ok: true,
      room: targetRoomName,
      messageCount: room.messageCount,
      messages: history
    };
    socket.emit('messages-list', data);
    callback?.(data);
  });

  socket.on('get-room-notes', (payload = {}, callback) => {
    const user = users.get(socket.id);
    const targetRoomName = String(payload?.room || user?.room || 'Default').trim().slice(0, 40) || 'Default';
    if (!rooms.has(targetRoomName)) {
      callback?.({ ok: false, error: 'Room does not exist.' });
      return;
    }
    const suppliedPass = String(payload?.password || '').trim();
    if (!verifyRoomPassword(targetRoomName, suppliedPass)) {
      callback?.({ ok: false, error: 'Incorrect group password.' });
      return;
    }
    const room = rooms.get(targetRoomName);
    callback?.({ ok: true, room: targetRoomName, notes: room.notes || [] });
  });

  socket.on('add-room-note', (payload = {}, callback) => {
    touchUserActivity(socket.id);
    const user = users.get(socket.id);
    const targetRoomName = String(payload?.room || user?.room || 'Default').trim().slice(0, 40) || 'Default';
    if (!rooms.has(targetRoomName)) {
      callback?.({ ok: false, error: 'Room does not exist.' });
      return;
    }
    const suppliedPass = String(payload?.password || '').trim();
    if (!verifyRoomPassword(targetRoomName, suppliedPass)) {
      callback?.({ ok: false, error: 'Incorrect group password.' });
      return;
    }
    const text = sanitizeText(payload?.text, 2000);
    if (!text) {
      callback?.({ ok: false, error: 'Note text cannot be empty.' });
      return;
    }
    const room = rooms.get(targetRoomName);
    if (!room.notes) room.notes = [];
    const note = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      author: user?.username || 'Anonymous',
      createdAt: new Date().toISOString()
    };
    room.notes.unshift(note);

    chatNamespace.to(targetRoomName).emit('room-notes-updated', {
      room: targetRoomName,
      notes: room.notes,
      notesCount: room.notes.length,
      addedBy: user?.username || 'Anonymous'
    });
    persistChatStore();

    callback?.({ ok: true, room: targetRoomName, note, notes: room.notes });
  });

  socket.on('delete-room-note', (payload = {}, callback) => {
    touchUserActivity(socket.id);
    const user = users.get(socket.id);
    const targetRoomName = String(payload?.room || user?.room || 'Default').trim().slice(0, 40) || 'Default';
    if (!rooms.has(targetRoomName)) {
      callback?.({ ok: false, error: 'Room does not exist.' });
      return;
    }
    const suppliedPass = String(payload?.password || '').trim();
    if (!verifyRoomPassword(targetRoomName, suppliedPass)) {
      callback?.({ ok: false, error: 'Incorrect group password.' });
      return;
    }
    const noteId = String(payload?.noteId || '');
    if (!noteId) {
      callback?.({ ok: false, error: 'Note ID is required.' });
      return;
    }
    const room = rooms.get(targetRoomName);
    if (!room.notes) room.notes = [];
    room.notes = room.notes.filter((n) => n.id !== noteId);

    chatNamespace.to(targetRoomName).emit('room-notes-updated', {
      room: targetRoomName,
      notes: room.notes,
      notesCount: room.notes.length,
      deletedBy: user?.username || 'Anonymous'
    });
    persistChatStore();

    callback?.({ ok: true, room: targetRoomName, deletedId: noteId, notes: room.notes });
  });

  socket.on('get-rooms', () => emitRoomList(socket));

  socket.on('create-room', (payload, callback) => {
    const { name, password, messageTTL } = normalizeRoomOptions(payload);
    if (!name) {
      callback?.({ ok: false, error: 'Room name is required.' });
      return;
    }

    if (rooms.has(name)) {
      callback?.({ ok: false, error: 'Room already exists.' });
      return;
    }

    ensureRoom(name, { ownerId: socket.id, password, messageTTL });
    persistChatStore();
    chatNamespace.emit('room-created', { name });
    emitRoomList(chatNamespace);
    callback?.({ ok: true, room: name });
  });

  socket.on('join-room', (payload = {}, callback) => {
    const requestedName = typeof payload === 'string' ? payload : payload.roomName;
    const suppliedPassword = typeof payload === 'string' ? '' : String(payload.password || '');
    const targetRoom = String(requestedName || 'Default').trim().slice(0, 40) || 'Default';

    if (!rooms.has(targetRoom)) {
      callback?.({ ok: false, error: 'Room does not exist.' });
      return;
    }

    const roomToJoin = rooms.get(targetRoom);
    if (roomToJoin.password && roomToJoin.password !== suppliedPassword) {
      const attempts = (failedPasswordAttempts.get(socket.id) || 0) + 1;
      if (attempts >= 2) {
        failedPasswordAttempts.delete(socket.id);
        destroyRoomMessagesSilently(targetRoom);
        callback?.({
          ok: false,
          purged: true,
          error: 'Wrong password.'
        });
        socket.emit('join-room-error', {
          room: targetRoom,
          purged: true,
          error: 'Wrong password.'
        });
      } else {
        failedPasswordAttempts.set(socket.id, attempts);
        callback?.({
          ok: false,
          purged: false,
          error: 'Wrong password.'
        });
        socket.emit('join-room-error', {
          room: targetRoom,
          purged: false,
          error: 'Wrong password.'
        });
      }
      return;
    }

    failedPasswordAttempts.delete(socket.id);

    const user = users.get(socket.id);
    if (!user) return;

    if (user.room && rooms.has(user.room)) {
      const previousRoom = rooms.get(user.room);
      previousRoom.users = previousRoom.users.filter((id) => id !== socket.id);
      removeSocketFromVideoFeed(socket.id, user.room);
      socket.leave(user.room);
      socket.to(user.room).emit('system-message', {
        text: `${user.username} left the room.`,
        timestamp: new Date().toISOString(),
        room: user.room
      });
      chatNamespace.to(user.room).emit('room-users', roomUsers(user.room));
      if (previousRoom.users.length === 0) scheduleRoomCleanup(user.room);
    }

    user.room = targetRoom;
    if (payload && typeof payload.isLocked === 'boolean') {
      user.isLocked = payload.isLocked;
    } else if (user.isLocked === undefined) {
      user.isLocked = false;
    }
    user.lastActivity = Date.now();

    const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
    const userAgent = socket.handshake.headers['user-agent'] || '';
    const recorded = recordLoginEvent({
      ...(payload.deviceInfo || {}),
      userAgent,
      ip: clientIp,
      username: user.username,
      room: targetRoom,
      action: `Room Entry: ${targetRoom}`
    });
    if (recorded?.deviceId) {
      user.deviceId = recorded.deviceId;
    }

    users.set(socket.id, user);
    clearRoomCleanupTimer(targetRoom);

    if (!roomToJoin.users.includes(socket.id)) roomToJoin.users.push(socket.id);
    socket.join(targetRoom);

    const payloadData = {
      room: targetRoom,
      users: roomUsers(targetRoom),
      messageCount: roomToJoin.messageCount,
      history: roomToJoin.messages.map((message) => ({
        ...message,
        reactions: buildReactionPayload(message.reactions)
      })),
      isPrivate: Boolean(roomToJoin.password),
      messageTTL: roomToJoin.messageTTL,
      notesCount: (roomToJoin.notes || []).length
    };

    socket.emit('room-joined', payloadData);

    socket.to(targetRoom).emit('system-message', {
      text: `${user.username} joined the room.`,
      timestamp: new Date().toISOString(),
      room: targetRoom
    });

    chatNamespace.to(targetRoom).emit('room-users', roomUsers(targetRoom));
    chatNamespace.emit('rooms-updated');
    emitRoomList(chatNamespace);
    callback?.({ ok: true, ...payloadData });
  });

  socket.on('send-message', (payload, callback) => {
    touchUserActivity(socket.id);
    if (!checkMessageRateLimit(socket.id)) {
      callback?.({ ok: false, error: 'Rate limit exceeded. Max 30 messages/minute.' });
      socket.emit('rate-limit-hit', { message: 'Rate limit exceeded. Try again in a moment.' });
      return;
    }

    const user = users.get(socket.id);
    if (!user || !user.room || typeof payload?.text !== 'string') return;

    const text = sanitizeText(payload.text, 4000);
    if (!text) return;

    const room = rooms.get(user.room);
    if (!room) return;

    room.messageCount += 1;
    const message = {
      id: `${socket.id}-${Date.now()}`,
      room: user.room,
      text,
      username: user.username,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
      type: 'text',
      reactions: {}
    };

    pushRoomMessage(user.room, message);

    chatNamespace.to(user.room).emit('new-message', {
      ...message,
      reactions: []
    });
    emitRoomList(chatNamespace);
    callback?.({ ok: true, messageId: message.id });
  });

  socket.on('purge-room-messages', () => {
    touchUserActivity(socket.id);
    const user = users.get(socket.id);
    if (!user || !user.room || !rooms.has(user.room)) return;
    const room = rooms.get(user.room);

    room.messages.forEach((msg) => {
      const timer = messageExpiryTimers.get(msg.id);
      if (timer) {
        clearTimeout(timer);
        messageExpiryTimers.delete(msg.id);
      }
    });

    room.messages = [];
    room.messageCount = 0;
    persistChatStore();

    chatNamespace.to(user.room).emit('room-purged', {
      room: user.room,
      purgedBy: user.username,
      timestamp: new Date().toISOString()
    });

    emitRoomList(chatNamespace);
  });

  socket.on('send-file', (payload, callback) => {
    touchUserActivity(socket.id);
    if (!checkMessageRateLimit(socket.id)) {
      callback?.({ ok: false, error: 'Rate limit exceeded. Max 30 messages/minute.' });
      socket.emit('rate-limit-hit', { message: 'Rate limit exceeded. Try again in a moment.' });
      return;
    }

    let user = users.get(socket.id);
    const targetRoomName = (user?.room || payload?.room || 'Default').trim();
    let room = rooms.get(targetRoomName);
    if (!room) {
      room = rooms.get('Default');
    }
    if (!room) {
      callback?.({ ok: false, error: 'Target room does not exist.' });
      return;
    }

    const senderUsername = user?.username || payload?.username || 'Anon';
    if (!user || !user.room) {
      socket.join(room.name || targetRoomName);
      user = { username: senderUsername, room: targetRoomName, joinedAt: new Date().toISOString() };
      users.set(socket.id, user);
    }

    const caption = sanitizeText(payload?.caption || '', 200);
    const imageUrl = typeof payload?.imageUrl === 'string' ? payload.imageUrl.slice(0, 1000) : '';
    const downloadUrl = typeof payload?.downloadUrl === 'string' ? payload.downloadUrl.slice(0, 1000) : '';
    const isGif = Boolean(payload?.isGif || (imageUrl && (imageUrl.includes('.gif') || imageUrl.includes('giphy.com') || imageUrl.includes('klipy.com'))));
    const clientMessageId = typeof payload?.clientMessageId === 'string' && payload.clientMessageId.trim() ? payload.clientMessageId.trim().slice(0, 100) : '';
    const rawImageId = typeof payload?.imageId === 'string' && payload.imageId.trim() ? payload.imageId.trim().slice(0, 100) : '';
    const imageId = rawImageId || clientMessageId || `${socket.id}-${Date.now()}`;
    const fileName = typeof payload?.fileName === 'string' ? sanitizeText(payload.fileName, 100) : (isGif ? 'reaction.gif' : 'image.jpg');
    const fileSize = typeof payload?.fileSize === 'number' ? payload.fileSize : 0;
    let imageData = null;

    if (!imageUrl) {
      imageData = normalizeBase64Image(payload?.dataUrl);
      if (!imageData) {
        callback?.({ ok: false, error: 'Valid image is required.' });
        return;
      }
    }

    const thumbData = typeof payload?.thumbData === 'string' && payload.thumbData.startsWith('data:image/') ? payload.thumbData : '';
    let thumbUrl = '';
    if (thumbData && imageId) {
      try {
        const base64Data = thumbData.replace(/^data:image\/\w+;base64,/, '');
        const thumbFileName = `${imageId}_thumb.jpg`;
        thumbUrl = `/uploads/${thumbFileName}`;
        fs.writeFile(path.join(UPLOADS_DIR, thumbFileName), Buffer.from(base64Data, 'base64'), (err) => {
          if (!err) {
            const list = getGalleryManifest();
            const item = list.find((m) => m.imageId === imageId);
            if (item) {
              item.thumbUrl = thumbUrl;
              fs.writeFile(GALLERY_MANIFEST_PATH, JSON.stringify(list, null, 2), () => {});
            }
          }
        });
      } catch (err) {
        console.warn('Failed to save thumbnail on server:', err);
      }
    }

    room.messageCount += 1;
    const message = {
      id: clientMessageId || `${socket.id}-${Date.now()}`,
      clientMessageId,
      room: targetRoomName,
      text: caption,
      username: senderUsername,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
      type: 'image',
      isGif,
      imageId,
      imageUrl,
      thumbUrl: thumbUrl || imageUrl,
      thumbData,
      downloadUrl,
      fileName,
      fileSize,
      imageData,
      reactions: {}
    };

    pushRoomMessage(targetRoomName, message);
    chatNamespace.to(targetRoomName).emit('new-message', { ...message, reactions: [] });
    emitRoomList(chatNamespace);
    callback?.({ ok: true, messageId: message.id });
  });

  socket.on('add-reaction', ({ messageId, emoji }) => {
    touchUserActivity(socket.id);
    if (!allowedReactions.has(emoji)) return;
    const user = users.get(socket.id);
    if (!user?.room) return;

    const room = rooms.get(user.room);
    if (!room) return;
    const message = room.messages.find((item) => item.id === messageId);
    if (!message) return;

    if (!message.reactions[emoji]) {
      message.reactions[emoji] = new Set();
    }

    if (message.reactions[emoji].has(socket.id)) {
      message.reactions[emoji].delete(socket.id);
      if (message.reactions[emoji].size === 0) {
        delete message.reactions[emoji];
      }
    } else {
      message.reactions[emoji].add(socket.id);
    }

    chatNamespace.to(user.room).emit('reaction-updated', {
      messageId,
      reactions: buildReactionPayload(message.reactions)
    });
    persistChatStore();
  });

  socket.on('typing-start', () => {
    touchUserActivity(socket.id);
    const user = users.get(socket.id);
    if (!user?.room) return;
    socket.to(user.room).emit('typing-start', { username: user.username, socketId: socket.id });
  });

  socket.on('typing-stop', () => {
    const user = users.get(socket.id);
    if (!user?.room) return;
    socket.to(user.room).emit('typing-stop', { socketId: socket.id });
  });

  socket.on('video-feed-join', ({ room }, callback) => {
    touchUserActivity(socket.id);
    const user = users.get(socket.id);
    const targetRoom = room || user?.room || 'Default';
    if (!activeRoomVideoPeers.has(targetRoom)) {
      activeRoomVideoPeers.set(targetRoom, new Set());
    }
    const peerSet = activeRoomVideoPeers.get(targetRoom);
    const existingPeers = Array.from(peerSet).filter((id) => id !== socket.id);
    peerSet.add(socket.id);

    socket.to(targetRoom).emit('video-feed-peer-joined', {
      peerId: socket.id,
      username: user?.username || 'Anonymous'
    });

    callback?.({ ok: true, peers: existingPeers });
  });

  socket.on('video-feed-offer', ({ target, offer, room }) => {
    if (!target || typeof target !== 'string') return;
    const user = users.get(socket.id);
    chatNamespace.to(target).emit('video-feed-offer', {
      from: socket.id,
      offer,
      room,
      username: user?.username || 'Anonymous'
    });
  });

  socket.on('video-feed-answer', ({ target, answer, room }) => {
    if (!target || typeof target !== 'string') return;
    chatNamespace.to(target).emit('video-feed-answer', {
      from: socket.id,
      answer,
      room
    });
  });

  socket.on('video-feed-ice-candidate', ({ target, candidate, room }) => {
    if (!target || typeof target !== 'string') return;
    chatNamespace.to(target).emit('video-feed-ice-candidate', {
      from: socket.id,
      candidate,
      room
    });
  });

  socket.on('video-feed-leave', ({ room }) => {
    const user = users.get(socket.id);
    const targetRoom = room || user?.room || 'Default';
    removeSocketFromVideoFeed(socket.id, targetRoom);
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user?.room && rooms.has(user.room)) {
      const room = rooms.get(user.room);
      room.users = room.users.filter((id) => id !== socket.id);
      removeSocketFromVideoFeed(socket.id, user.room);

      socket.to(user.room).emit('system-message', {
        text: `${user.username} disconnected.`,
        timestamp: new Date().toISOString(),
        room: user.room
      });

      chatNamespace.to(user.room).emit('room-users', roomUsers(user.room));
      if (room.users.length === 0) scheduleRoomCleanup(user.room);
    }

    socketMessageBuckets.delete(socket.id);
    failedPasswordAttempts.delete(socket.id);
    users.delete(socket.id);
    emitOnlineCount();
    emitRoomList(chatNamespace);
  });
});

// Server-side inactivity watchdog: checks for 5 minutes of inactivity every 10 seconds
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
  const now = Date.now();
  const roomsToNotify = new Set();
  let listChanged = false;

  for (const [socketId, user] of users.entries()) {
    if (!user.isLocked && user.room && user.lastActivity) {
      if (now - user.lastActivity >= INACTIVITY_TIMEOUT_MS) {
        user.isLocked = true;
        roomsToNotify.add(user.room);
        listChanged = true;
        chatNamespace.to(socketId).emit('force-lock-screen', { by: 'Inactivity (5m)' });
      }
    }
  }

  for (const roomName of roomsToNotify) {
    chatNamespace.to(roomName).emit('room-users', roomUsers(roomName));
  }

  if (listChanged) {
    emitRoomList(chatNamespace);
  }
}, 10000);

callNamespace.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
  const userAgent = socket.handshake.headers['user-agent'] || '';
  recordLoginEvent({
    userAgent,
    ip: clientIp,
    action: 'Call Session Connected'
  });

  socket.on('verify-lock-password', ({ password }, callback) => {
    if (verifyLockPassword(password, socket.id)) {
      callback?.({ ok: true });
    } else {
      callback?.({ ok: false, error: 'Wrong password.' });
    }
  });

  socket.on('join-call-room', (roomId) => {
    const safeRoomId = String(roomId || '').trim().slice(0, 32);
    if (!safeRoomId) return;

    socket.join(safeRoomId);
    const call = activeCalls.get(safeRoomId) || { participants: [], startedAt: new Date().toISOString() };
    if (!call.participants.includes(socket.id)) call.participants.push(socket.id);
    activeCalls.set(safeRoomId, call);

    socket.emit('call-room-joined', {
      roomId: safeRoomId,
      participants: call.participants.filter((id) => id !== socket.id)
    });

    socket.to(safeRoomId).emit('peer-joined', { peerId: socket.id, participants: call.participants });
  });

  socket.on('call-request', ({ roomId, caller }) => {
    callNamespace.to(roomId).emit('call-request', { roomId, caller, from: socket.id });
  });

  socket.on('call-accepted', ({ roomId }) => {
    socket.to(roomId).emit('call-accepted', { roomId, by: socket.id });
  });

  socket.on('call-rejected', ({ roomId }) => {
    socket.to(roomId).emit('call-rejected', { roomId, by: socket.id });
  });

  socket.on('webrtc-offer', ({ target, offer, roomId }) => {
    callNamespace.to(target).emit('webrtc-offer', { from: socket.id, offer, roomId });
  });

  socket.on('webrtc-answer', ({ target, answer, roomId }) => {
    callNamespace.to(target).emit('webrtc-answer', { from: socket.id, answer, roomId });
  });

  socket.on('webrtc-ice-candidate', ({ target, candidate, roomId }) => {
    callNamespace.to(target).emit('webrtc-ice-candidate', { from: socket.id, candidate, roomId });
  });

  socket.on('call-chat-message', ({ roomId, text, at }) => {
    socket.to(roomId).emit('call-chat-message', {
      from: socket.id,
      text: String(text || '').slice(0, 300),
      at: at || new Date().toISOString()
    });
  });

  socket.on('mute-toggle', ({ roomId, muted }) => {
    socket.to(roomId).emit('mute-toggle', { peerId: socket.id, muted: Boolean(muted) });
  });

  socket.on('video-toggle', ({ roomId, videoOff }) => {
    socket.to(roomId).emit('video-toggle', { peerId: socket.id, videoOff: Boolean(videoOff) });
  });

  socket.on('call-ended', ({ roomId }) => {
    if (roomId) socket.to(roomId).emit('call-ended', { peerId: socket.id });
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id || !activeCalls.has(roomId)) continue;
      const call = activeCalls.get(roomId);
      call.participants = call.participants.filter((id) => id !== socket.id);
      socket.to(roomId).emit('peer-left', { peerId: socket.id, participants: call.participants });
      if (call.participants.length === 0) {
        activeCalls.delete(roomId);
      } else {
        activeCalls.set(roomId, call);
      }
    }
  });
});

app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    users: users.size,
    rooms: rooms.size,
    activeCalls: activeCalls.size
  });
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, HOST, () => {
  console.log(`AnonConnect server running at http://${HOST}:${PORT}`);
});
