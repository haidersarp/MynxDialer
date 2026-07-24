// ─────────────────────────────────────────────────────────────────────────────
// sipClient.js — TRAINEE listen-only WebRTC line.
//
// Adapted from the agent client, with one deliberate and load-bearing
// difference: THIS CLIENT NEVER REQUESTS A MICROPHONE.
//
//   • no navigator.mediaDevices.getUserMedia() call anywhere in this file
//   • mediaConstraints: { audio: false, video: false }
//   • rtcOfferConstraints: offerToReceiveAudio → the SDP offer is RECVONLY
//
// The browser therefore never prompts for mic permission and there is no
// outbound audio track to send. This is the third of three independent layers
// that make it impossible for a trainee to be heard:
//   1. Asterisk [from-trainee] exposes only *55 (ChanSpy without w/B/d)
//   2. pjsipConfig puts trainee endpoints in that context, never from-admin
//   3. this file — no mic, recvonly SDP
// Any one of the three alone is sufficient. All three are in place.
//
// PC_CONFIG is copied verbatim from the working agent client: our own coturn
// STUN is what makes DTLS complete reliably here. Do not swap it for a public
// STUN server — that was the cause of the live-but-silent audio bug.
// ─────────────────────────────────────────────────────────────────────────────
import JsSIP from 'jssip';

let ua = null;
let listenSession = null;
let keepAliveCtx = null;

const PC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ],
  iceTransportPolicy: 'all'
};

// Chrome hibernates silent background tabs, which stalls WebSocket/SIP
// processing. A 0-gain oscillator keeps the audio pipeline (and the tab) live.
export function initKeepAlive() {
  if (keepAliveCtx) {
    if (keepAliveCtx.state === 'suspended') keepAliveCtx.resume().catch(() => {});
    return;
  }
  try {
    keepAliveCtx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = keepAliveCtx.createGain();
    gain.gain.value = 0;
    gain.connect(keepAliveCtx.destination);
    const osc = keepAliveCtx.createOscillator();
    osc.frequency.value = 1;
    osc.connect(gain);
    osc.start();
  } catch (e) {
    console.warn('[TRAINEE SIP] keep-alive failed:', e.message);
  }
}

let audioElement = null;
export function setAudioElement(el) { audioElement = el; }

function attachRemoteStream(stream) {
  if (!audioElement) return;
  if (keepAliveCtx && keepAliveCtx.state === 'suspended') keepAliveCtx.resume().catch(() => {});
  audioElement.srcObject = stream;
  audioElement.muted = false;
  audioElement.volume = 1.0;
  const tryPlay = (attempt) => {
    audioElement.play().catch(err => {
      console.warn(`[TRAINEE SIP] audio play blocked (attempt ${attempt}):`, err.message);
      if (attempt < 5) setTimeout(() => tryPlay(attempt + 1), 600);
    });
  };
  tryPlay(1);
}

// Pull the remote track straight off the peer connection — timing-independent
// fallback for when the 'track' event does not fire.
function attachFromSession(session) {
  try {
    const pc = session?.connection;
    if (!pc) return;
    const stream = new MediaStream();
    (pc.getReceivers ? pc.getReceivers() : []).forEach(r => {
      if (r.track && r.track.kind === 'audio') stream.addTrack(r.track);
    });
    if (stream.getAudioTracks().length > 0) attachRemoteStream(stream);
  } catch (e) {
    console.warn('[TRAINEE SIP] attachFromSession failed:', e.message);
  }
}

export function initSIP(config, handlers = {}) {
  if (ua) {
    try { ua.stop(); } catch (_) {}
    ua = null;
  }

  const socket = new JsSIP.WebSocketInterface(config.ws_servers);
  ua = new JsSIP.UA({
    sockets: [socket],
    uri: config.uri,
    password: config.password,
    display_name: config.display_name,
    register: true,
    register_expires: 300,
    connection_recovery_min_interval: 2,
    connection_recovery_max_interval: 30,
    user_agent: 'MynxDialer-Trainee/1.0',
    pcConfig: PC_CONFIG
  });

  ua.on('registered',         () => handlers.onRegistered?.());
  ua.on('unregistered',       () => handlers.onUnregistered?.());
  ua.on('registrationFailed', (e) => handlers.onRegistrationFailed?.(e.cause));

  ua.on('newRTCSession', ({ session, originator }) => {
    // A trainee endpoint should never receive an inbound call — [from-trainee]
    // has no path that dials one. Reject defensively rather than answering.
    if (originator !== 'local') {
      try { session.terminate(); } catch (_) {}
      return;
    }
    listenSession = session;

    session.on('confirmed', () => {
      attachFromSession(session);
      handlers.onListening?.();
    });
    session.on('ended',  () => { listenSession = null; handlers.onStopped?.(); });
    session.on('failed', (e) => { listenSession = null; handlers.onFailed?.(e?.cause); });

    session.connection?.addEventListener?.('track', (ev) => {
      if (ev.streams && ev.streams[0]) attachRemoteStream(ev.streams[0]);
      else attachFromSession(session);
    });
  });

  ua.start();
  return ua;
}

// Dial *55<agentExt>. Browser-INITIATED, matching the proven admin Live Monitor
// path — Asterisk never dials us, which is what keeps DTLS reliable here.
export function startListening(dialTarget) {
  if (!ua) throw new Error('SIP not initialised');
  stopListening(); // never hold two spy legs at once

  ua.call(dialTarget, {
    // NO MICROPHONE. audio:false means JsSIP does not call getUserMedia, so the
    // browser never prompts and no local track exists to transmit.
    mediaConstraints: { audio: false, video: false },
    // Receive-only offer: we want their audio, we send none.
    rtcOfferConstraints: { offerToReceiveAudio: 1, offerToReceiveVideo: 0 },
    pcConfig: PC_CONFIG
  });
}

export function stopListening() {
  if (listenSession) {
    try { listenSession.terminate(); } catch (_) {}
    listenSession = null;
  }
  if (audioElement) {
    try { audioElement.srcObject = null; } catch (_) {}
  }
}

export function isListening() { return !!listenSession; }

export function stopSIP() {
  stopListening();
  if (ua) { try { ua.stop(); } catch (_) {} ua = null; }
}
