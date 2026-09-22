const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

export async function getUserMediaStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (error) {
    throw new Error(`Unable to access media devices: ${error.message}`);
  }
}

export async function getVideoOnlyStream() {
  const sanitize = (stream) => {
    stream.getAudioTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
    });
    return stream;
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 24, max: 30 },
        facingMode: 'user'
      }
    });
    return sanitize(stream);
  } catch (err) {
    console.warn('[WebRTC] Camera ideal constraints failed, attempting basic fallback:', err);
    try {
      const fallbackStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true
      });
      return sanitize(fallbackStream);
    } catch (fallbackErr) {
      throw new Error(`Unable to access camera: ${fallbackErr.message}`);
    }
  }
}

export function createPeerConnection({ localStream, onIceCandidate, onTrack, onConnectionStateChange }) {
  const peer = new RTCPeerConnection(rtcConfig);
  peer._pendingCandidates = [];

  let hasVideoTrack = false;
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      // If audio track somehow present in localStream, skip it
      if (track.kind === 'audio' && !localStream.hasAudio) {
        track.stop();
        return;
      }
      if (track.kind === 'video') {
        hasVideoTrack = true;
        peer.addTrack(track, localStream);
      }
    });
  }

  // Ensure peer is always ready to receive video even if local camera is unavailable or pending
  if (!hasVideoTrack) {
    try {
      peer.addTransceiver('video', { direction: 'recvonly' });
    } catch (err) {
      console.warn('[WebRTC] Could not add recvonly video transceiver:', err);
    }
  }

  peer.onicecandidate = (event) => {
    if (event.candidate && event.candidate.candidate && onIceCandidate) {
      onIceCandidate(event.candidate);
    }
  };

  peer.ontrack = (event) => {
    let stream = event.streams && event.streams[0];
    if (!stream) {
      stream = new MediaStream();
      if (event.track) {
        stream.addTrack(event.track);
      }
    }
    // Guarantee silent video: stop and mute any incoming audio tracks
    stream.getAudioTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
    });
    if (onTrack) {
      onTrack(stream, event.track);
    }
  };

  if (onConnectionStateChange) {
    peer.onconnectionstatechange = () => {
      onConnectionStateChange(peer.connectionState);
    };
  }

  return peer;
}

export async function createOffer(peer) {
  const offer = await peer.createOffer({
    offerToReceiveVideo: true,
    offerToReceiveAudio: false
  });
  await peer.setLocalDescription(offer);
  return {
    type: peer.localDescription?.type || offer.type || 'offer',
    sdp: peer.localDescription?.sdp || offer.sdp
  };
}

export async function flushPendingCandidates(peer) {
  if (peer && peer._pendingCandidates && peer._pendingCandidates.length > 0) {
    const list = peer._pendingCandidates.splice(0);
    for (const cand of list) {
      if (!cand || !cand.candidate) continue;
      try {
        await peer.addIceCandidate(cand);
      } catch (err) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Error applying queued candidate:', e);
        }
      }
    }
  }
}

export async function handleOffer(peer, offer) {
  await peer.setRemoteDescription(new RTCSessionDescription({
    type: offer.type || 'offer',
    sdp: offer.sdp
  }));
  await flushPendingCandidates(peer);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  return {
    type: peer.localDescription?.type || answer.type || 'answer',
    sdp: peer.localDescription?.sdp || answer.sdp
  };
}

export async function handleAnswer(peer, answer) {
  await peer.setRemoteDescription(new RTCSessionDescription({
    type: answer.type || 'answer',
    sdp: answer.sdp
  }));
  await flushPendingCandidates(peer);
}

export async function handleIceCandidate(peer, candidate) {
  if (!candidate || !candidate.candidate) return;
  if (!peer.remoteDescription || !peer.remoteDescription.type) {
    if (!peer._pendingCandidates) peer._pendingCandidates = [];
    peer._pendingCandidates.push(candidate);
    return;
  }
  try {
    await peer.addIceCandidate(candidate);
  } catch (err) {
    try {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('Error adding ICE candidate:', e);
    }
  }
}

export function addRemoteStream(stream, peerId, videoGrid) {
  const existing = document.getElementById(`remote-${peerId}`);
  if (existing) {
    existing.srcObject = stream;
    return existing;
  }
  const video = document.createElement('video');
  video.id = `remote-${peerId}`;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  videoGrid.appendChild(video);
  return video;
}

export function removeRemoteStream(peerId) {
  document.getElementById(`remote-${peerId}`)?.remove();
}

export function handlePeerDisconnect(peerId, peers) {
  if (peers.has(peerId)) {
    peers.get(peerId).close();
    peers.delete(peerId);
  }
  removeRemoteStream(peerId);
}
