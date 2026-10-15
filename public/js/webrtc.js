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

export async function getUserMediaStream(constraints = { audio: true, video: true }) {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    console.warn('[WebRTC] Preferred constraints failed, attempting basic fallback:', error);
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 640 }, height: { ideal: 480 } }
      });
    } catch (fallbackError) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (audioErr) {
        throw new Error(`Unable to access camera or microphone: ${error.message}`);
      }
    }
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

export function createPeerConnection({
  localStream,
  onIceCandidate,
  onTrack,
  onConnectionStateChange,
  enableAudio = true
}) {
  const peer = new RTCPeerConnection(rtcConfig);
  peer._pendingCandidates = [];

  let hasVideoTrack = false;
  let hasAudioTrack = false;

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      if (track.kind === 'audio') {
        if (!enableAudio) {
          return;
        }
        hasAudioTrack = true;
        peer.addTrack(track, localStream);
      } else if (track.kind === 'video') {
        hasVideoTrack = true;
        peer.addTrack(track, localStream);
      }
    });
  }

  // Ensure peer is always ready to receive video/audio even if local track is not attached yet
  if (!hasVideoTrack) {
    try {
      peer.addTransceiver('video', { direction: 'recvonly' });
    } catch (err) {
      console.warn('[WebRTC] Could not add recvonly video transceiver:', err);
    }
  }
  if (!hasAudioTrack && enableAudio) {
    try {
      peer.addTransceiver('audio', { direction: 'recvonly' });
    } catch (err) {
      console.warn('[WebRTC] Could not add recvonly audio transceiver:', err);
    }
  }

  peer.onicecandidate = (event) => {
    if (event.candidate && onIceCandidate) {
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
    // Only mute audio if explicitly a silent video connection
    if (!enableAudio) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
    }
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

export async function createOffer(peer, options = {}) {
  const offerToReceiveAudio = options.offerToReceiveAudio !== undefined ? Boolean(options.offerToReceiveAudio) : true;
  const offerToReceiveVideo = options.offerToReceiveVideo !== undefined ? Boolean(options.offerToReceiveVideo) : true;

  const offer = await peer.createOffer({
    offerToReceiveVideo,
    offerToReceiveAudio
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
  const isCollision = peer.signalingState !== 'stable';
  if (isCollision) {
    if (!peer._isPolite) {
      console.warn('[WebRTC] Impolite peer ignoring colliding offer');
      return null;
    }
    console.log('[WebRTC] Polite peer rolling back local description for colliding offer');
    try {
      await peer.setLocalDescription({ type: 'rollback' });
    } catch (err) {
      console.warn('[WebRTC] Rollback error:', err);
    }
  }

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
  if (peer.signalingState !== 'have-local-offer') {
    console.warn(`[WebRTC] Ignoring answer in unexpected state: ${peer.signalingState}`);
    return;
  }
  await peer.setRemoteDescription(new RTCSessionDescription({
    type: answer.type || 'answer',
    sdp: answer.sdp
  }));
  await flushPendingCandidates(peer);
}

export async function handleIceCandidate(peer, candidate) {
  if (!candidate) return;
  const candPayload = candidate.candidate !== undefined ? candidate : { candidate };
  if (!candPayload.candidate) return;

  if (!peer.remoteDescription || !peer.remoteDescription.type) {
    if (!peer._pendingCandidates) peer._pendingCandidates = [];
    peer._pendingCandidates.push(candPayload);
    return;
  }
  try {
    await peer.addIceCandidate(new RTCIceCandidate(candPayload));
  } catch (err) {
    console.warn('[WebRTC] Error adding ICE candidate:', err);
  }
}

export function addRemoteStream(stream, peerId, videoGrid) {
  let video = document.getElementById(`remote-${peerId}`);
  if (!video) {
    video = document.createElement('video');
    video.id = `remote-${peerId}`;
    video.autoplay = true;
    video.playsInline = true;
    videoGrid.appendChild(video);
  }
  video.srcObject = stream;
  video.muted = false; // ensure remote audio can be heard
  video.play().catch((err) => {
    console.warn('[WebRTC] Remote video play error:', err);
  });
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
