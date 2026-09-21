const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

export async function getUserMediaStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (error) {
    throw new Error(`Unable to access media devices: ${error.message}`);
  }
}

export async function getVideoOnlyStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 640, min: 320 },
        height: { ideal: 480, min: 240 },
        frameRate: { ideal: 24, max: 30 },
        facingMode: 'user'
      }
    });
    // Ensure any unexpected audio tracks are completely killed
    stream.getAudioTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
    });
    return stream;
  } catch (error) {
    throw new Error(`Unable to access camera: ${error.message}`);
  }
}

export function createPeerConnection({ localStream, onIceCandidate, onTrack, onConnectionStateChange }) {
  const peer = new RTCPeerConnection(rtcConfig);
  peer._pendingCandidates = [];

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      // If audio track somehow present in localStream, skip it
      if (track.kind === 'audio' && !localStream.hasAudio) {
        track.stop();
        return;
      }
      peer.addTrack(track, localStream);
    });
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
      stream.addTrack(event.track);
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
  return offer;
}

export async function flushPendingCandidates(peer) {
  if (peer && peer._pendingCandidates && peer._pendingCandidates.length > 0) {
    const list = peer._pendingCandidates.splice(0);
    for (const cand of list) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn('Error applying queued candidate:', err);
      }
    }
  }
}

export async function handleOffer(peer, offer) {
  await peer.setRemoteDescription(new RTCSessionDescription(offer));
  await flushPendingCandidates(peer);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  return answer;
}

export async function handleAnswer(peer, answer) {
  await peer.setRemoteDescription(new RTCSessionDescription(answer));
  await flushPendingCandidates(peer);
}

export async function handleIceCandidate(peer, candidate) {
  if (!candidate) return;
  if (!peer.remoteDescription || !peer.remoteDescription.type) {
    if (!peer._pendingCandidates) peer._pendingCandidates = [];
    peer._pendingCandidates.push(candidate);
    return;
  }
  try {
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn('Error adding ICE candidate:', err);
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
