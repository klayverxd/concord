'use strict';

/* ------------------------------------------------------------------ *
 * Sala — voz + tela + conversa para grupos pequenos.
 * Conexões são ponto a ponto (WebRTC em malha). O servidor só apresenta
 * as pessoas umas às outras e carrega o texto, os áudios e as reações.
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

const el = {
  gate: $('gate'), gateError: $('gateError'),
  roomInput: $('roomInput'), nameInput: $('nameInput'), enterBtn: $('enterBtn'),
  app: $('app'), roomName: $('roomName'), count: $('count'),
  onair: $('onair'), onairLabel: $('onairLabel'),
  copyBtn: $('copyBtn'), leaveBtn: $('leaveBtn'),
  strips: $('strips'), screens: $('screens'), stageEmpty: $('stageEmpty'),
  log: $('log'), msgInput: $('msgInput'), sendBtn: $('sendBtn'),
  emojiRow: $('emojiRow'), recBtn: $('recBtn'), recHint: $('recHint'), recTime: $('recTime'),
  micBtn: $('micBtn'), shareBtn: $('shareBtn'),
  floats: $('floats'), audios: $('audios')
};

const state = {
  me: null,
  room: null,
  socket: null,
  mic: null,          // MediaStream do microfone
  screen: null,       // MediaStream da tela
  ice: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
  peers: new Map(),   // id -> { pc, name, ... }
  meters: new Map(),  // chave -> { analyser, buf, bars, strip }
  audioCtx: null
};

const EMOJIS = ['😂', '💀', '🔥', '👏', '😱', '🤝', '❤️', '👎', '🎯', '🍿'];

/* ------------------------------ entrada ------------------------------ */

if (location.hash.length > 1) {
  el.roomInput.value = decodeURIComponent(location.hash.slice(1));
}
el.nameInput.value = localStorage.getItem('sala:nome') || '';
(el.roomInput.value ? el.nameInput : el.roomInput).focus();

el.enterBtn.addEventListener('click', enter);
[el.roomInput, el.nameInput].forEach((input) => {
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
});

async function enter() {
  const room = el.roomInput.value.trim().toLowerCase();
  const name = el.nameInput.value.trim();
  if (!room || !name) {
    el.gateError.textContent = 'Preencha o nome do grupo e o seu apelido.';
    return;
  }
  el.enterBtn.disabled = true;
  el.gateError.textContent = '';

  try {
    state.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (err) {
    el.gateError.textContent = 'Não deu para usar o microfone. Libere o acesso no navegador e tente de novo.';
    el.enterBtn.disabled = false;
    return;
  }

  try {
    const res = await fetch('/ice-config');
    if (res.ok) state.ice = await res.json();
  } catch (_) { /* segue com o STUN padrão */ }

  localStorage.setItem('sala:nome', name);
  connect(room, name);
}

/* ------------------------------ conexão ------------------------------ */

function connect(room, name) {
  const socket = io();
  state.socket = socket;

  socket.on('connect', () => {
    socket.emit('join', { room, name }, (reply) => {
      if (reply?.error) {
        el.gateError.textContent = reply.error;
        el.enterBtn.disabled = false;
        socket.disconnect();
        return;
      }
      state.me = reply.you;
      state.room = reply.room;
      openRoom();
      reply.peers.forEach((p) => {
        addStrip(p.id, p.name);
        setStripState(p.id, p);
        ensurePeer(p.id, p.name);
      });
      refreshCount();
    });
  });

  socket.on('peer-joined', ({ id, name: peerName }) => {
    addStrip(id, peerName);
    ensurePeer(id, peerName);
    system(`${peerName} entrou`);
    refreshCount();
  });

  socket.on('peer-left', ({ id }) => {
    const p = state.peers.get(id);
    if (p) {
      p.pc.close();
      p.audioEls.forEach((a) => a.remove());
      state.peers.delete(id);
      system(`${p.name} saiu`);
    }
    removeScreen(id);
    removeStrip(id);
    refreshCount();
  });

  socket.on('peer-state', ({ id, muted, sharing }) => {
    setStripState(id, { muted, sharing });
    if (sharing === false) removeScreen(id);
    updateOnAir();
  });

  socket.on('signal', handleSignal);
  socket.on('chat', (m) => renderMessage(m, 'text'));
  socket.on('voice-note', (m) => renderMessage(m, 'audio'));
  socket.on('reaction', ({ emoji, name: who }) => floatEmoji(emoji, who));

  socket.on('disconnect', () => system('conexão caiu — recarregue a página'));
}

function openRoom() {
  el.gate.hidden = true;
  el.app.hidden = false;
  el.roomName.textContent = state.room;
  location.hash = encodeURIComponent(state.room);
  document.title = `#${state.room} · Sala`;

  addStrip(state.me.id, `${state.me.name} (você)`);
  startAudioContext();
  attachMeter(state.me.id, state.mic);
  buildEmojiRow();
  setPane('stagePane');
  updateStageEmpty();
}

/* --------------------------- pares WebRTC --------------------------- */

function ensurePeer(id, name) {
  if (state.peers.has(id)) return state.peers.get(id);

  const pc = new RTCPeerConnection(state.ice);
  const peer = { id, name, pc, polite: state.me.id > id, makingOffer: false, ignoreOffer: false, screenSenders: [], audioEls: [], hasMeter: false };
  state.peers.set(id, peer);

  state.mic.getAudioTracks().forEach((t) => pc.addTrack(t, state.mic));
  if (state.screen) {
    state.screen.getTracks().forEach((t) => peer.screenSenders.push(pc.addTrack(t, state.screen)));
  }

  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      state.socket.emit('signal', { to: id, description: pc.localDescription });
    } catch (err) {
      console.error('negociação', err);
    } finally {
      peer.makingOffer = false;
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) state.socket.emit('signal', { to: id, candidate });
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') pc.restartIce();
  };

  pc.ontrack = ({ track }) => {
    if (track.kind === 'video') receiveScreen(peer, track);
    else receiveAudio(peer, track);
  };

  return peer;
}

async function handleSignal({ from, description, candidate }) {
  const peer = state.peers.get(from) || ensurePeer(from, 'alguém');
  const pc = peer.pc;

  try {
    if (description) {
      const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;

      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        state.socket.emit('signal', { to: from, description: pc.localDescription });
      }
    } else if (candidate) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        if (!peer.ignoreOffer) throw err;
      }
    }
  } catch (err) {
    console.error('sinalização', err);
  }
}

function receiveAudio(peer, track) {
  const stream = new MediaStream([track]);
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.srcObject = stream;
  el.audios.appendChild(audio);
  audio.play().catch(() => {});
  peer.audioEls.push(audio);

  if (!peer.hasMeter) {
    peer.hasMeter = true;
    attachMeter(peer.id, stream);
  }

  track.addEventListener('ended', () => {
    audio.remove();
    peer.audioEls = peer.audioEls.filter((a) => a !== audio);
  });
}

/* --------------------------- transmissão --------------------------- */

el.shareBtn.addEventListener('click', () => (state.screen ? stopShare() : startShare()));

async function startShare() {
  if (!navigator.mediaDevices.getDisplayMedia) {
    system('este navegador não transmite tela — use Chrome, Edge ou Firefox no computador');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: true
    });
  } catch (_) {
    return; // pessoa cancelou o seletor
  }

  state.screen = stream;
  state.peers.forEach((peer) => {
    stream.getTracks().forEach((t) => peer.screenSenders.push(peer.pc.addTrack(t, stream)));
  });

  stream.getVideoTracks()[0].addEventListener('ended', stopShare);
  showScreen(state.me.id, `${state.me.name} (você)`, stream, true);

  el.shareBtn.textContent = 'parar transmissão';
  el.shareBtn.dataset.live = 'true';
  state.socket.emit('state', { sharing: true });
  setStripState(state.me.id, { sharing: true });
  updateOnAir();
  setPane('stagePane');
}

function stopShare() {
  if (!state.screen) return;
  state.screen.getTracks().forEach((t) => t.stop());
  state.peers.forEach((peer) => {
    peer.screenSenders.forEach((s) => {
      try { peer.pc.removeTrack(s); } catch (_) {}
    });
    peer.screenSenders = [];
  });
  state.screen = null;
  removeScreen(state.me.id);

  el.shareBtn.textContent = 'transmitir tela';
  delete el.shareBtn.dataset.live;
  state.socket.emit('state', { sharing: false });
  setStripState(state.me.id, { sharing: false });
  updateOnAir();
}

function receiveScreen(peer, track) {
  const stream = new MediaStream([track]);
  showScreen(peer.id, peer.name, stream, false);
  setStripState(peer.id, { sharing: true });
  updateOnAir();
  track.addEventListener('ended', () => {
    removeScreen(peer.id);
    setStripState(peer.id, { sharing: false });
    updateOnAir();
  });
}

function showScreen(id, who, stream, isLocal) {
  removeScreen(id);

  const box = document.createElement('div');
  box.className = 'screen';
  box.dataset.owner = id;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal; // evita microfonia com a própria transmissão
  video.srcObject = stream;
  video.play().catch(() => {});

  const tally = document.createElement('span');
  tally.className = 'screen-tally';
  tally.innerHTML = '<span class="bulb"></span>';
  tally.append(document.createTextNode(who));

  const full = document.createElement('button');
  full.className = 'btn btn-ghost screen-full';
  full.textContent = 'tela cheia';
  full.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else box.requestFullscreen?.();
  });

  box.append(video, tally, full);
  el.screens.appendChild(box);
  updateStageEmpty();
}

function removeScreen(id) {
  el.screens.querySelector(`.screen[data-owner="${CSS.escape(id)}"]`)?.remove();
  updateStageEmpty();
}

function updateStageEmpty() {
  const n = el.screens.children.length;
  el.stageEmpty.hidden = n > 0;
  el.screens.dataset.many = String(n > 1);
}

function updateOnAir() {
  const live = el.screens.children.length > 0;
  el.onair.dataset.live = String(live);
  el.onairLabel.textContent = live ? 'no ar' : 'fora do ar';
}

/* ------------------------------ microfone ------------------------------ */

el.micBtn.addEventListener('click', () => {
  const track = state.mic.getAudioTracks()[0];
  track.enabled = !track.enabled;
  el.micBtn.dataset.on = String(track.enabled);
  el.micBtn.textContent = track.enabled ? 'microfone ligado' : 'microfone mudo';
  state.socket.emit('state', { muted: !track.enabled });
  setStripState(state.me.id, { muted: !track.enabled });
});

/* --------------------------- faixas de canal --------------------------- */

function addStrip(id, name) {
  if (el.strips.querySelector(`[data-id="${CSS.escape(id)}"]`)) return;

  const li = document.createElement('li');
  li.className = 'strip';
  li.dataset.id = id;

  const top = document.createElement('div');
  top.className = 'strip-top';

  const nameEl = document.createElement('span');
  nameEl.className = 'strip-name';
  nameEl.textContent = name;

  const tag = document.createElement('span');
  tag.className = 'strip-tag';
  tag.textContent = 'ouvindo';

  const meter = document.createElement('div');
  meter.className = 'meter';
  for (let i = 0; i < 14; i++) meter.appendChild(document.createElement('i'));

  top.append(nameEl, tag);
  li.append(top, meter);
  el.strips.appendChild(li);
}

function removeStrip(id) {
  el.strips.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
  state.meters.delete(id);
}

function setStripState(id, { muted, sharing } = {}) {
  const li = el.strips.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!li) return;
  if (typeof muted === 'boolean') li.dataset.muted = String(muted);
  if (typeof sharing === 'boolean') li.dataset.sharing = String(sharing);

  const tag = li.querySelector('.strip-tag');
  if (li.dataset.muted === 'true') tag.textContent = 'mudo';
  else if (li.dataset.sharing === 'true') tag.textContent = 'transmitindo';
  else tag.textContent = 'ouvindo';
}

function refreshCount() {
  el.count.textContent = String(el.strips.children.length);
}

/* ------------------------- medidores de voz ------------------------- */

function startAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  state.audioCtx = new Ctx();
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  requestAnimationFrame(tickMeters);
}

function attachMeter(id, stream) {
  if (!state.audioCtx || !stream.getAudioTracks().length) return;
  const source = state.audioCtx.createMediaStreamSource(stream);
  const analyser = state.audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);
  state.meters.set(id, { analyser, buf: new Uint8Array(analyser.frequencyBinCount) });
}

function tickMeters() {
  state.meters.forEach(({ analyser, buf }, id) => {
    const li = el.strips.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!li) return;

    analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length) / 255;

    const muted = li.dataset.muted === 'true';
    const level = muted ? 0 : Math.min(1, rms * 3.2);
    const lit = Math.round(level * 14);

    const bars = li.querySelectorAll('.meter i');
    for (let i = 0; i < bars.length; i++) {
      bars[i].dataset.lit = i < lit ? '1' : '0';
    }
    li.dataset.talking = String(lit >= 2);
  });
  requestAnimationFrame(tickMeters);
}

/* ------------------------------ conversa ------------------------------ */

el.sendBtn.addEventListener('click', sendText);
el.msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });

function sendText() {
  const text = el.msgInput.value.trim();
  if (!text) return;
  state.socket.emit('chat', { text });
  el.msgInput.value = '';
}

function renderMessage(m, kind) {
  const li = document.createElement('li');
  li.className = 'msg';

  const head = document.createElement('div');
  head.className = 'msg-head';

  const who = document.createElement('span');
  who.className = 'msg-who';
  who.textContent = m.id === state.me.id ? 'você' : m.name;

  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  head.append(who, time);
  li.append(head);

  if (kind === 'text') {
    const body = document.createElement('div');
    body.className = 'msg-body';
    if (isOnlyEmoji(m.text)) body.classList.add('is-emoji');
    body.textContent = m.text;
    li.append(body);
  } else {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = m.data;
    const label = document.createElement('div');
    label.className = 'msg-body';
    label.textContent = `áudio · ${formatSeconds(m.seconds)}`;
    li.append(label, audio);
  }

  el.log.appendChild(li);
  el.log.scrollTop = el.log.scrollHeight;
}

function system(text) {
  const li = document.createElement('li');
  li.className = 'msg msg-system';
  li.textContent = text;
  el.log.appendChild(li);
  el.log.scrollTop = el.log.scrollHeight;
}

function isOnlyEmoji(text) {
  return text.length <= 8 && /^\p{Extended_Pictographic}+$/u.test(text.replace(/\uFE0F/g, ''));
}

function formatSeconds(s) {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/* ------------------------------ reações ------------------------------ */

function buildEmojiRow() {
  const label = document.createElement('span');
  label.className = 'emoji-label';
  label.textContent = 'reagir';
  el.emojiRow.appendChild(label);

  EMOJIS.forEach((emoji) => {
    const b = document.createElement('button');
    b.className = 'emoji-btn';
    b.type = 'button';
    b.textContent = emoji;
    b.title = `Mostrar ${emoji} para todo mundo`;
    b.addEventListener('click', () => state.socket.emit('reaction', { emoji }));
    el.emojiRow.appendChild(b);
  });
}

function floatEmoji(emoji, who) {
  const div = document.createElement('div');
  div.className = 'float';
  div.textContent = emoji;
  const tag = document.createElement('small');
  tag.textContent = who;
  div.appendChild(tag);
  div.style.left = `${8 + Math.random() * 78}%`;
  el.floats.appendChild(div);
  setTimeout(() => div.remove(), 2600);
}

/* --------------------------- áudio gravado --------------------------- */

let rec = null;

el.recBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); startRec(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
  el.recBtn.addEventListener(ev, () => stopRec());
});
el.recBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    rec ? stopRec() : startRec();
  }
});

async function startRec() {
  if (rec) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) {
    system('sem acesso ao microfone para gravar');
    return;
  }

  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  const startedAt = Date.now();

  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(rec.timer);
    rec = null;
    el.recBtn.dataset.rec = 'false';
    el.recHint.hidden = true;

    const seconds = (Date.now() - startedAt) / 1000;
    if (seconds < 0.5) return; // toque acidental

    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    if (blob.size > 4e6) {
      system('áudio muito longo — grave até uns 45 segundos');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => state.socket.emit('voice-note', { data: reader.result, seconds, mime: blob.type });
    reader.readAsDataURL(blob);
  };

  rec = {
    recorder,
    timer: setInterval(() => {
      const s = (Date.now() - startedAt) / 1000;
      el.recTime.textContent = formatSeconds(s);
      if (s >= 60) stopRec();
    }, 200)
  };

  recorder.start();
  el.recBtn.dataset.rec = 'true';
  el.recTime.textContent = '0:00';
  el.recHint.hidden = false;
}

function stopRec() {
  if (rec && rec.recorder.state === 'recording') rec.recorder.stop();
}

/* ------------------------------ diversos ------------------------------ */

el.copyBtn.addEventListener('click', async () => {
  const link = `${location.origin}/#${encodeURIComponent(state.room)}`;
  try {
    await navigator.clipboard.writeText(link);
    el.copyBtn.textContent = 'link copiado';
  } catch (_) {
    el.copyBtn.textContent = link;
  }
  setTimeout(() => { el.copyBtn.textContent = 'copiar link'; }, 2000);
});

el.leaveBtn.addEventListener('click', () => {
  stopShare();
  state.mic?.getTracks().forEach((t) => t.stop());
  state.socket?.disconnect();
  location.reload();
});

document.querySelectorAll('.btn-tab').forEach((b) => {
  b.addEventListener('click', () => setPane(b.dataset.pane));
});

function setPane(id) {
  ['deckPane', 'stagePane', 'chatPane'].forEach((p) => {
    $(p).classList.toggle('is-open', p === id);
  });
  document.querySelectorAll('.btn-tab').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.pane === id);
  });
}

window.addEventListener('beforeunload', () => {
  state.socket?.disconnect();
});
