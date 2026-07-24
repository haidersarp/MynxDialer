import JsSIP from 'jssip';

let ua = null;
let currentSession = null;
let eventHandlers = {};
let keepAliveCtx = null;

// STUN/TURN served by our OWN coturn on the dialer host (YOUR_SERVER_IP:3478).
// Google/Cloudflare STUN were unreachable from the agent network, so host-only
// ICE was used — but then the browser only advertised its private LAN address,
// and Asterisk could not reliably learn the browser's public address during the
// DTLS handshake (which happens before media), so DTLS stalled → live-but-silent
// audio. Our own STUN gives the browser a real public (srflx) candidate so DTLS
// and RTP lock onto the right address; TURN relays through the server if direct
// media is ever blocked. Both are on the same host the browser already reaches.
const PC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ],
  iceTransportPolicy: 'all'
};

// Call after a user gesture (e.g. "Start Calls") to keep the tab active.
// Chrome hibernates background tabs that have no Web Audio activity,
// which prevents WebSocket messages (SIP INVITEs) from being processed.
export function initKeepAlive() {
  if (keepAliveCtx) {
    if (keepAliveCtx.state === 'suspended') keepAliveCtx.resume().catch(() => {});
    return;
  }
  try {
    keepAliveCtx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = keepAliveCtx.createGain();
    gain.gain.value = 0; // completely silent
    gain.connect(keepAliveCtx.destination);
    const osc = keepAliveCtx.createOscillator();
    osc.frequency.value = 1; // 1 Hz — inaudible
    osc.connect(gain);
    osc.start();
    console.log('[SIP] Keep-alive AudioContext started — tab will stay active');
  } catch (e) {
    console.warn('[SIP] Keep-alive AudioContext failed:', e.message);
  }
}

JsSIP.debug.disable('JsSIP:*');

// Request microphone permission upfront so browser is ready when call arrives
export async function requestMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(t => t.stop()); // stop immediately, just needed the permission
    console.log('[SIP] Microphone permission granted');
    return true;
  } catch (err) {
    console.warn('[SIP] Microphone permission denied:', err.message);
    return false;
  }
}

// Play local DTMF tone using Web Audio API
export function playDTMFTone(digit) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freqs = {
      '1':[697,1209],'2':[697,1336],'3':[697,1477],
      '4':[770,1209],'5':[770,1336],'6':[770,1477],
      '7':[852,1209],'8':[852,1336],'9':[852,1477],
      '*':[941,1209],'0':[941,1336],'#':[941,1477]
    };
    const [f1, f2] = freqs[digit] || [941, 1336];
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);
    [f1, f2].forEach(freq => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    });
    setTimeout(() => ctx.close(), 500);
  } catch (_) {}
}

// Connect a remote MediaStream to the speaker output.
// Use ONLY the HTML <audio> element. Do NOT route the remote stream through
// Web Audio (keepAliveCtx.createMediaStreamSource): in Chrome that "captures"
// the track for the audio graph and SUPPRESSES the <audio> element's playback —
// if the graph's output is ever inaudible you get total silence even though the
// track is live and play() resolves OK. The <audio> element alone is the
// canonical, reliable sink for WebRTC remote audio. The keep-alive AudioContext
// stays (its silent oscillator keeps the tab awake) but never touches this stream.
export function attachRemoteAudio(stream, audioElement) {
  if (!stream) { console.warn('[SIP] attachRemoteAudio: no stream'); return; }
  const tracks = stream.getAudioTracks();
  console.log('[SIP] attachRemoteAudio — audio tracks:', tracks.length, tracks.map(t => t.readyState));

  if (!audioElement) { console.warn('[SIP] attachRemoteAudio: no <audio> element'); return; }
  // Make sure the keep-alive context is running so the OS audio pipeline is live.
  if (keepAliveCtx && keepAliveCtx.state === 'suspended') keepAliveCtx.resume().catch(() => {});

  audioElement.srcObject = stream;
  audioElement.muted = false;
  audioElement.volume = 1.0;
  const tryPlay = (attempt) => {
    audioElement.play()
      .then(() => console.log('[SIP] HTML audio element play OK'))
      .catch(err => {
        console.error(`[SIP] HTML audio play blocked (attempt ${attempt}):`, err.message);
        if (attempt < 5) setTimeout(() => tryPlay(attempt + 1), 600);
      });
  };
  tryPlay(1);
}

// Pull the remote audio track directly off the session's RTCPeerConnection and
// hand it to the app's onRemoteStream (which routes it to the speakers). This is
// a timing-independent fallback for when the 'track' event doesn't fire.
function attachRemoteFromSession(session, handlers) {
  try {
    const pc = session?.connection;
    if (!pc) { console.warn('[SIP] attachRemoteFromSession: no pc'); return; }
    const stream = new MediaStream();
    const receivers = pc.getReceivers ? pc.getReceivers() : [];
    receivers.forEach(r => { if (r.track && r.track.kind === 'audio') stream.addTrack(r.track); });
    // Fallback to getRemoteStreams() for older WebRTC stacks
    if (stream.getAudioTracks().length === 0 && pc.getRemoteStreams) {
      const rs = pc.getRemoteStreams()[0];
      if (rs) rs.getAudioTracks().forEach(t => stream.addTrack(t));
    }
    if (stream.getAudioTracks().length > 0) {
      console.log('[SIP] Attaching remote audio from session (fallback) — tracks:', stream.getAudioTracks().length);
      handlers?.onRemoteStream?.(stream);
    } else {
      console.warn('[SIP] attachRemoteFromSession: no remote audio track yet');
    }
  } catch (err) {
    console.warn('[SIP] attachRemoteFromSession failed:', err.message);
  }
}

export function initSIP(config, handlers) {
  if (ua) {
    try { ua.stop(); } catch (_) {}
    ua = null;
  }

  eventHandlers = handlers || {};

  const socket = new JsSIP.WebSocketInterface(config.ws_servers);

  const uaConfig = {
    sockets: [socket],
    uri: config.uri,
    password: config.password,
    display_name: config.display_name,
    register: true,
    register_expires: 300,
    connection_recovery_min_interval: 2,
    connection_recovery_max_interval: 30,
    user_agent: 'MynxDialer/1.0',
    // STUN servers so the browser discovers its public IP and includes it in ICE
    // candidates. Without this, Asterisk only sees private IPs from the browser
    // and ICE fails → DTLS dropped → no audio.
    pcConfig: PC_CONFIG
  };

  ua = new JsSIP.UA(uaConfig);

  ua.on('registered', () => {
    console.log('[SIP] Registered');
    handlers?.onRegistered?.();
  });

  ua.on('unregistered', () => {
    console.log('[SIP] Unregistered');
    handlers?.onUnregistered?.();
  });

  ua.on('registrationFailed', (e) => {
    console.error('[SIP] Registration failed:', e.cause);
    handlers?.onRegistrationFailed?.(e.cause);
  });

  ua.on('newRTCSession', (data) => {
    const { session, originator } = data;
    currentSession = session;

    // Send the INVITE as soon as we have a usable candidate instead of waiting
    // for Chrome to FULLY finish ICE gathering. JsSIP otherwise holds the INVITE
    // until iceGatheringState === 'complete', which can take 30-40s if any ICE
    // server is slow/unreachable — that was the long delay before calls connected.
    // We proceed the instant a server-reflexive (public) candidate is ready (all
    // Asterisk needs for DTLS/RTP), or after a short timeout as a safety net.
    let iceProceeded = false;
    let iceTimer = null;
    const proceedIce = (ready, why) => {
      if (iceProceeded || typeof ready !== 'function') return;
      iceProceeded = true;
      if (iceTimer) { clearTimeout(iceTimer); iceTimer = null; }
      console.log('[SIP] Sending INVITE now —', why);
      try { ready(); } catch (_) {}
    };
    session.on('icecandidate', (data) => {
      const c = data.candidate;
      if (c && c.candidate && c.candidate.indexOf('typ srflx') !== -1) {
        proceedIce(data.ready, 'public (srflx) candidate ready');
      } else if (!iceTimer) {
        // Safety net: if no srflx arrives quickly, go anyway with host candidates.
        iceTimer = setTimeout(() => proceedIce(data.ready, 'ICE gathering timeout (2s)'), 2000);
      }
    });

    session.on('confirmed', () => {
      console.log('[SIP] Call confirmed');
      handlers?.onCallConfirmed?.(session);
      // Robustly attach remote audio. The 'peerconnection'/'track' events do not
      // reliably fire for outgoing calls in this setup, so the remote audio was
      // never routed to the speakers (one-way silence even though RTP arrives).
      // Pull the remote audio track straight from the RTCPeerConnection here —
      // by 'confirmed' the remote description is set so the receiver track exists.
      attachRemoteFromSession(session, handlers);
      // Retry shortly after in case the track is added a beat later.
      setTimeout(() => attachRemoteFromSession(session, handlers), 1200);
    });

    session.on('failed', (e) => {
      console.log('[SIP] Call failed:', e.cause);
      currentSession = null;
      handlers?.onCallFailed?.(e.cause);
    });

    session.on('ended', (e) => {
      console.log('[SIP] Call ended:', e.cause);
      currentSession = null;
      handlers?.onCallEnded?.(e.cause);
    });

    session.on('peerconnection', (data) => {
      const pc = data.peerconnection;
      console.log('[SIP] PeerConnection created');

      pc.addEventListener('iceconnectionstatechange', () => {
        console.log('[SIP] ICE connection state:', pc.iceConnectionState);
      });
      pc.addEventListener('connectionstatechange', () => {
        console.log('[SIP] Connection state:', pc.connectionState);
      });
      pc.addEventListener('icegatheringstatechange', () => {
        console.log('[SIP] ICE gathering state:', pc.iceGatheringState);
      });
      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) console.log('[SIP] ICE candidate:', e.candidate.type, e.candidate.address || '?', e.candidate.port || '?');
        else console.log('[SIP] ICE gathering complete');
      });

      // addEventListener keeps JsSIP's own handlers intact (ontrack= would overwrite them).
      // Asterisk frequently omits a=msid in SDP answers so e.streams is empty —
      // in that case we build the MediaStream manually from the track.
      pc.addEventListener('track', (e) => {
        const kind = e.track?.kind;
        console.log('[SIP] ontrack:', kind, e.track?.readyState, '— streams:', e.streams?.length);
        if (kind !== 'audio') return;
        const stream = (e.streams && e.streams.length > 0)
          ? e.streams[0]
          : new MediaStream([e.track]);
        handlers?.onRemoteStream?.(stream);
      });
    });

    session.on('muted', () => handlers?.onMuted?.(true));
    session.on('unmuted', () => handlers?.onMuted?.(false));
    session.on('hold', (data) => handlers?.onHold?.(data.originator === 'local'));
    session.on('unhold', () => handlers?.onHold?.(false));

    // Notify the app LAST — onIncoming auto-answers server-initiated calls (dialer
    // leads, TEST AUDIO), which kicks off ICE/DTLS and the remote track. If we did
    // this before registering the handlers above, those calls would answer before
    // the icecandidate (fast-connect) / confirmed (audio-attach) / track listeners
    // existed → no agent audio on inbound calls even though outbound (*43, manual)
    // worked. Registering all session handlers first fixes inbound-call audio.
    if (originator === 'remote') {
      const callerNumber = session.remote_identity?.uri?.user || 'Unknown';
      const callerName = session.remote_identity?.display_name || callerNumber;
      handlers?.onIncoming?.(session, callerNumber, callerName);
    } else {
      // Outbound call — notify immediately so UI shows ringing state right away
      handlers?.onOutgoing?.(session);
    }
  });

  ua.start();
  return ua;
}

export function answer(session) {
  const target = session || currentSession;
  if (!target) { console.warn('[SIP] answer() called but no session'); return; }
  const options = {
    mediaConstraints: { audio: true, video: false },
    rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
    pcConfig: PC_CONFIG
  };
  try {
    target.answer(options);
    console.log('[SIP] session.answer() called OK');
  } catch (err) {
    console.error('[SIP] session.answer() threw:', err.message);
  }
}

export function makeCall(target, sipConfig) {
  if (!ua) throw new Error('SIP not initialized');

  // This is always triggered by a user gesture (click), so start the keep-alive
  // AudioContext here if it isn't running yet — ensures Web Audio API is available
  // for attachRemoteAudio() even when the agent dials without clicking Start Calls.
  initKeepAlive();

  const options = {
    mediaConstraints: { audio: true, video: false },
    rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
    pcConfig: PC_CONFIG
  };

  const uri = target.includes('@') ? target : `sip:${target}@${sipConfig?.realm}`;
  console.log('[SIP] Calling:', uri);
  const session = ua.call(uri, options);
  currentSession = session;
  return session;
}

// ── Conference room: the agent's persistent audio leg ───────────────────────
// On "Available" the browser dials *88 to join its private ConfBridge room and
// stays there. This ONE browser-initiated call carries ALL lead audio (the
// dialer drops leads into the room server-side), so DTLS is set up once on the
// reliable outbound path — avoiding the server-initiated DTLS race. It's flagged
// so the UI doesn't treat it as a lead call; the lead UI is driven by socket
// events (call:assigned / answered / hangup).
let roomCallActive = false;

export function joinRoom(sipConfig) {
  roomCallActive = true;
  console.log('[SIP] Joining conference room (*88)');
  return makeCall('*88', sipConfig);
}

export function leaveRoom() {
  roomCallActive = false;
  console.log('[SIP] Leaving conference room');
  hangup();
}

export function isRoomCall() {
  return roomCallActive;
}

export function hangup() {
  if (currentSession) {
    try { currentSession.terminate(); } catch (_) {}
    currentSession = null;
  }
}

export function mute(muted) {
  if (!currentSession) return;
  if (muted) currentSession.mute({ audio: true });
  else currentSession.unmute({ audio: true });
}

export function hold(onHold) {
  if (!currentSession) return;
  if (onHold) currentSession.hold();
  else currentSession.unhold();
}

export function sendDTMF(digit) {
  currentSession?.sendDTMF(digit);
}

export function transfer(target, sipRealm) {
  if (!currentSession) return;
  const uri = target.includes('@') ? target : `sip:${target}@${sipRealm}`;
  currentSession.refer(uri);
}

export function getCurrentSession() { return currentSession; }

export function stopSIP() {
  if (currentSession) {
    try { currentSession.terminate(); } catch (_) {}
    currentSession = null;
  }
  if (ua) {
    try { ua.stop(); } catch (_) {}
    ua = null;
  }
}

export function isRegistered() {
  return ua?.isRegistered() || false;
}
