# AnonConnect (AConnect)

> Truly anonymous real-time chat & WebRTC video calls with a Quantum Word Cloud HUD — no database, no accounts, no traces.

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![Socket.io](https://img.shields.io/badge/Socket.io-4.6-blue) ![WebRTC](https://img.shields.io/badge/WebRTC-P2P-orange) ![Docker](https://img.shields.io/badge/Docker-Ready-cyan) ![License](https://img.shields.io/badge/License-MIT-purple)

---

## What is AnonConnect?

AnonConnect (AConnect) is a futuristic, anonymous communication platform featuring a **Sci-Fi Quantum Word Cloud HUD**. Users receive a random identity upon connecting — no signups, no logins, and zero data persistence. Every message, room, and call lives strictly in server memory and vanishes automatically on restart or TTL expiration.

---

## Key Features & Session Updates

### 🌐 Direct Chat Landing & Security
- **Root Landing Route (`/`)**: Directly serves `chat.html` on default application load.
- **Environment Password (`DEFAULT_ROOM_PASSWORD`)**: Default room password is easily overridable via environment variables (default: `turtle`).
- **Security Clearance Prompt**: No automatic login. Landing users must enter the password to gain access to the room matrix.

### ⚛️ Sci-Fi Quantum Word Cloud HUD
- **3D Canvas Cloud Matrix**: Interactive word cloud engine visualization with user-color-coded transmission nodes.
- **Multi-View Modes**: Switch dynamically between `🌐 Orbit View`, `⏱️ Chrono Flow`, and `🔥 Heatmap`.
- **Mobile-First HUD Layout**: 100dvh viewport container preventing bouncy-scrolling with a permanently fixed message input deck.
- **Backdrop Overlay Sidebars**: Touch-outside backdrop overlay to seamlessly toggle and close rooms/nodes drawers on mobile devices.

### 🗑️ Instant Message Purge & Call Deck
- **Instant Room Wipe (`🗑️`)**: Floating bottom-right trash button triggers real-time message destruction and cancels active room timers across all room clients.
- **Floating Call Button (`⚡ Call`)**: Bottom-left glassmorphic call button for instant WebRTC video/voice calls.

### 📹 Voice & Video Calls (WebRTC)
- Peer-to-peer WebRTC signaling (server relays signals only; media is direct P2P).
- Support for up to 4 participants, screen sharing, camera/mic mute controls, and side chat panel.

---

## Quick Start

### Running Locally
```bash
git clone https://github.com/your-username/AnonConnect.git
cd AnonConnect
npm install
npm start
```
Open → **http://localhost:9876**

### Docker Deployment
```bash
# Build Docker image
docker build -t aconnect-app .

# Run container on port 9876 with default password 'turtle'
docker run -d --name aconnect-app -p 9876:9876 aconnect-app:latest

# Custom password & port override:
docker run -d --name aconnect-app -p 9876:9876 -e DEFAULT_ROOM_PASSWORD=your_custom_pass aconnect-app:latest
```
Access in browser: `http://localhost:9876`

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `9876` | Server port |
| `DEFAULT_ROOM_PASSWORD` | `turtle` | Baseline password required for the Default room |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |

---

## Socket Events Reference

### `/chat` Namespace

| Event | Direction | Description |
|---|---|---|
| `welcome` | server → client | Assigns random identity on socket connect |
| `join-room` | client → server | Authenticate and join room matrix |
| `purge-room-messages` | client → server | Destroy all active room messages immediately |
| `room-purged` | server → room | Broadcasts message purge notification across clients |
| `send-message` | client → server | Transmit message to room matrix |
| `send-file` | client → server | Transmit image (base64) to room |
| `typing-start` / `typing-stop` | client → server | Signal user transmission activity |
| `get-rooms` / `rooms-list` | bidirectional | Query and receive active rooms list |

---

## License

MIT License.
