'use strict';

/* ------------------------------------------------------------------ *
 * Concord — voz, tela e conversa para grupos pequenos.
 *
 * Voz e tela vão ponto a ponto (WebRTC em malha). O servidor só apresenta
 * as pessoas umas às outras e carrega o que é leve: texto, presença,
 * reações e avisos.
 *
 * O áudio que sai daqui não é o microfone cru: é uma mistura feita no
 * WebAudio (microfone + sons da soundboard). Isso deixa trocar de
 * microfone sem renegociar conexão nenhuma.
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

const el = {
  gate: $('gate'), gateError: $('gateError'), gateStatus: $('gateStatus'),
  gateLogin: $('gateLogin'), gatePick: $('gatePick'), gateLoading: $('gateLoading'),
  googleBtn: $('googleBtn'),
  pickName: $('pickName'), guildPick: $('guildPick'), pickError: $('pickError'),
  newGuildInput: $('newGuildInput'), newGuildBtn: $('newGuildBtn'),
  inviteInput: $('inviteInput'), inviteBtn: $('inviteBtn'), logoutBtn: $('logoutBtn'),
  rail: document.querySelector('.rail'), channels: document.querySelector('.channels'),

  app: $('app'), scrim: $('scrim'), toast: $('toast'), dropZone: $('dropZone'),
  callBanner: $('callBanner'), callBannerAvatar: $('callBannerAvatar'),
  callBannerName: $('callBannerName'), callBannerChannel: $('callBannerChannel'),
  callBannerAccept: $('callBannerAccept'), callBannerDecline: $('callBannerDecline'),
  profilePop: $('profilePop'), profileAvatar: $('profileAvatar'), profileName: $('profileName'),
  profileStatus: $('profileStatus'), profileRoles: $('profileRoles'), profileCallBtn: $('profileCallBtn'),
  railInitials: $('railInitials'), railCopy: $('railCopy'),
  sidebar: $('sidebar'), roomName: $('roomName'), copyBtn: $('copyBtn'),
  voiceChannel: $('voiceChannel'), textChannel: $('textChannel'),
  liveBadge: $('liveBadge'), unreadPill: $('unreadPill'),
  voiceMembers: $('voiceMembers'), membersPane: $('membersPane'),
  vsState: $('vsState'), vsRoom: $('vsRoom'),
  shareBtn: $('shareBtn'), leaveBtn: $('leaveBtn'),
  meCard: $('meCard'), meAvatar: $('meAvatar'), meName: $('meName'), meNote: $('meNote'),
  micBtn: $('micBtn'), deafBtn: $('deafBtn'), settingsBtn: $('settingsBtn'),

  menuBtn: $('menuBtn'), membersBtn: $('membersBtn'),
  nudgeBtn: $('nudgeBtn'), soundBtn: $('soundBtn'),
  topbarIco: $('topbarIco'), viewTitle: $('viewTitle'), viewSub: $('viewSub'),

  stageView: $('stageView'), tiles: $('tiles'), stageEmpty: $('stageEmpty'),
  soundTest: $('soundTest'),
  stageShareBtn: $('stageShareBtn'), stageShareLabel: $('stageShareLabel'),
  stageMicBtn: $('stageMicBtn'), stageMicLabel: $('stageMicLabel'),
  stageLeaveBtn: $('stageLeaveBtn'),

  chatView: $('chatView'), log: $('log'), typing: $('typing'),
  msgInput: $('msgInput'), sendBtn: $('sendBtn'), imageBtn: $('imageBtn'), fileInput: $('fileInput'),
  emojiBtn: $('emojiBtn'), emojiPop: $('emojiPop'),
  recBtn: $('recBtn'), recHint: $('recHint'), recTime: $('recTime'),
  replyBar: $('replyBar'), replyText: $('replyText'), replyCancel: $('replyCancel'),
  editHint: $('editHint'),

  statusPop: $('statusPop'), statusList: $('statusList'), noteInput: $('noteInput'),
  soundPop: $('soundPop'), soundGrid: $('soundGrid'),

  volumePop: $('volumePop'), volumeName: $('volumeName'),
  volumeRange: $('volumeRange'), volumeValue: $('volumeValue'), volumeMute: $('volumeMute'),
  liveSection: $('liveSection'), liveRange: $('liveRange'), liveValue: $('liveValue'),
  liveMute: $('liveMute'), liveNone: $('liveNone'), statsLine: $('statsLine'),

  settings: $('settings'), settingsClose: $('settingsClose'),
  settingsNav: $('settingsNav'), settingsPane: $('settingsPane'),
  nicknameInput: $('nicknameInput'), nicknameSaveBtn: $('nicknameSaveBtn'), nicknameMsg: $('nicknameMsg'),
  micSelect: $('micSelect'), outputRow: $('outputRow'), outSelect: $('outSelect'),
  qualitySelect: $('qualitySelect'), pttCheck: $('pttCheck'), testBar: $('testBar'),
  testVoiceBtn: $('testVoiceBtn'),
  soundsCheck: $('soundsCheck'), notifyCheck: $('notifyCheck'), awayCheck: $('awayCheck'),
  themeCheck: $('themeCheck'), toolNudge: $('toolNudge'), toolSound: $('toolSound'),
  noiseCheck: $('noiseCheck'),
  noiseSensitivityRow: $('noiseSensitivityRow'),
  noiseThresholdRange: $('noiseThresholdRange'),
  noiseThresholdVal: $('noiseThresholdVal'),
  thresholdMarker: $('thresholdMarker'),

  audioUnlock: $('audioUnlock'), floats: $('floats'), audios: $('audios')
};

const store = {
  get: (k, fallback = null) => localStorage.getItem(`concord:${k}`) ?? localStorage.getItem(`sala:${k}`) ?? fallback,
  set: (k, v) => localStorage.setItem(`concord:${k}`, v)
};

const state = {
  // conta e navegação
  token: null, user: null, guilds: [], guild: null,
  channels: [], roles: [], myPerms: '0',
  voiceChannel: null, textChannel: null,
  // Todo mundo do servidor (não só quem está numa chamada) e quem, entre
  // eles, está com o app aberto agora — o que a coluna da direita precisa
  // para mostrar online/offline de verdade em vez de só presença de voz.
  guildMembers: new Map(), presentUserIds: new Set(),

  me: null, room: null, name: null, socket: null, joined: false,
  mic: null,            // microfone cru vindo do getUserMedia
  outStream: null,      // o que realmente vai para os pares (mistura)
  screen: null,
  deaf: false, ptt: false, pttHeld: false,
  status: 'online', note: '', statusBeforeAway: null,
  view: 'stage', focused: null,
  quality: '1080', micId: '', sinkId: '',
  sounds: true, notify: false, autoAway: true, noiseSuppression: true, noiseThreshold: 20,
  ice: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
  members: new Map(), nodes: new Map(), peers: new Map(),
  meters: new Map(), volumes: new Map(),
  // Quem está em cada canal de voz do servidor — de todo mundo, não só de
  // quem entrou. channelId -> Map(socketId -> {id, userId, name, avatar,
  // muted, sharing, deaf}). Persiste através de qualquer redesenho da
  // barra lateral, o que é o que faltava para a lista não desaparecer.
  channelVoice: new Map(), rosterEls: new Map(), rosterMemberEls: new Map(),
  audioCtx: null, micSource: null, mixDest: null, noiseNode: null, noiseWorkletLoaded: false,
  rnnoiseNode: null, rnnoiseWorkletLoaded: false, rnnoiseWasmBytes: null, audioOutNode: null,
  messages: new Map(),  // id -> { msg, node }
  lastMsg: null, typers: new Map(), typingSentAt: 0,
  replyTo: null, editing: null,
  unread: 0, mentions: 0,
  volumeTarget: null,
  membersWanted: true, drawer: 'none',
  lastActivity: Date.now()
};

const EMOJIS = ['😂', '💀', '🔥', '👏', '😱', '🤝', '❤️', '👎', '🎯', '🍿', '🫡', '🤡'];
const AVATAR_COLORS = ['#22d3ee', '#8b5cf6', '#e879f9', '#34e07a', '#fcb84a', '#fb5b78', '#38bdf8', '#a3e635'];

const STATUSES = [
  { id: 'online',    label: 'Disponível',        color: 'var(--online)' },
  { id: 'ocupado',   label: 'Ocupado',           color: 'var(--busy)' },
  { id: 'volto',     label: 'Volto logo',        color: 'var(--away)' },
  { id: 'ausente',   label: 'Ausente',           color: 'var(--away)' },
  { id: 'invisivel', label: 'Aparecer invisível', color: 'var(--offline)' }
];

// Presets de captura de tela. Monitor inteiro em qualidade original entope
// o upload de quem transmite — por isso 1080p30 é o padrão.
const QUALITY = {
  '720':     { width: { ideal: 1280 }, height: { ideal: 720 },  frameRate: { ideal: 30, max: 30 } },
  '1080':    { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
  '1080-60': { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, max: 60 } },
  'source':  { frameRate: { ideal: 60 } }
};

// Atalhos de texto do Messenger. A ordem importa: `:-)` antes de `:)`.
const EMOTICONS = [
  [':-)', '🙂'], [':)', '🙂'], [':-D', '😄'], [':D', '😄'], ['xD', '😆'], ['XD', '😆'],
  [':-(', '🙁'], [':(', '🙁'], [';-)', '😉'], [';)', '😉'], [':-P', '😛'], [':P', '😛'],
  [':-O', '😮'], [":'(", '😢'], ['<3', '❤️'], ['(y)', '👍'], ['(n)', '👎'], [':|', '😐']
];

/* ------------------------------ utilidades ------------------------------ */

function colorFor(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initialsFor(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = [...parts[0]][0] || '';
  const b = parts.length > 1 ? [...parts[1]][0] || '' : '';
  return (a + b).toUpperCase();
}

function paintAvatar(node, name) {
  node.style.background = colorFor(name);
  node.textContent = initialsFor(name);
}

function icon(id, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls ? `ico ${cls}` : 'ico');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

/* `node.hidden = true` só funciona em HTMLElement. Num <svg> criado por
 * createElementNS a propriedade vira um campo solto: nenhum atributo é
 * escrito, o seletor [hidden] não casa e o ícone fica sempre aparecendo.
 * toggleAttribute existe em Element e serve para os dois casos. */
function setShown(node, show) {
  node.toggleAttribute('hidden', !show);
}

let toastTimer = null;
function toast(text, kind = 'warn') {
  el.toast.textContent = text;
  el.toast.dataset.kind = kind;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3400);
}

function formatSeconds(s) {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function typingSomewhere() {
  const t = document.activeElement?.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
}

const NARROW = matchMedia('(max-width: 760px)');
function isNarrow() { return NARROW.matches; }

/* ------------------------------ conta ------------------------------ */

function gateBusy(text) {
  el.gateStatus.textContent = text;
  el.gateStatus.hidden = false;
  el.gateError.textContent = '';
}

function mostrarLogin() {
  el.gateLoading.hidden = true;
  el.gatePick.hidden = true;
  el.gateLogin.hidden = false;
}

function gateFail(text) {
  mostrarLogin();
  el.gateStatus.hidden = true;
  el.gateError.textContent = text;
  el.googleBtn.disabled = false;
}

function micConstraints() {
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return state.micId ? { ...base, deviceId: { exact: state.micId } } : base;
}

/* Login sem SDK: o Supabase devolve o token no fragmento da URL, e o
 * fragmento nunca sai do navegador — não vai em log de servidor nem em
 * cabeçalho Referer. Uma dependência a menos e um vazamento a menos. */
let cfg = null;

async function api(caminho, opcoes = {}) {
  const res = await fetch(`/api${caminho}`, {
    ...opcoes,
    headers: {
      ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...opcoes.headers
    }
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo.error || `erro ${res.status}`);
  return corpo;
}

function tokenDoFragmento() {
  if (!location.hash.includes('access_token')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  const token = p.get('access_token');
  if (token) {
    // Some da barra de endereço para não ficar em histórico nem em captura.
    history.replaceState(null, '', location.pathname + location.search);
  }
  return token;
}

el.googleBtn.addEventListener('click', () => {
  if (!cfg?.ready) return gateFail('O servidor está sem as chaves do Supabase configuradas.');
  el.googleBtn.disabled = true;
  gateBusy('Levando você ao Google…');
  const volta = encodeURIComponent(location.origin + location.pathname);
  location.href = `${cfg.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${volta}`;
});

el.logoutBtn.addEventListener('click', () => {
  store.set('token', '');
  location.reload();
});

async function iniciar() {
  /* Decidido de forma SÍNCRONA, antes de qualquer ida à rede: se não há
   * token guardado, a tela certa já é o login — e não pisca nada. Havendo
   * token, fica no "carregando" até saber se ele presta. */
  const guardado = tokenDoFragmento() || store.get('token', '') || null;
  if (!guardado) mostrarLogin();

  try {
    cfg = await api('/config');
  } catch (_) {
    return gateFail('Não foi possível falar com o servidor.');
  }
  if (!cfg.ready) {
    return gateFail('O servidor ainda não tem as chaves do Supabase. Preencha o .env.');
  }

  state.token = guardado;
  if (!state.token) return;   // já está na tela de login

  store.set('token', state.token);
  gateBusy('Carregando sua conta…');

  let eu;
  try {
    eu = await api('/me', { method: 'POST' });
  } catch (err) {
    /* Antes isto engolia o erro e dizia sempre "sua sessão venceu" — o que
     * escondeu por completo um token assinado com algoritmo que o servidor
     * não aceitava. Agora o motivo real aparece. */
    state.token = null;
    const motivo = err.message || 'erro desconhecido';
    const venceu = /expirad|venceu|ausente|inválido|não existe/i.test(motivo);
    if (venceu) store.set('token', '');   // só descarta o que de fato não serve
    return gateFail(venceu ? `${motivo} Entre de novo.` : `Não deu para entrar: ${motivo}`);
  }

  state.user = eu.user;
  state.guilds = eu.guilds;
  el.gateStatus.hidden = true;

  // Convite no endereço entra direto, sem passar pela escolha.
  const convite = new URLSearchParams(location.search).get('convite');
  if (convite) {
    try {
      const r = await api(`/invites/${encodeURIComponent(convite)}/accept`, { method: 'POST' });
      history.replaceState(null, '', location.pathname);
      return abrirServidor(r.guild.id);
    } catch (err) {
      el.pickError.textContent = err.message;
    }
  }

  mostrarEscolha();
}

function mostrarEscolha() {
  el.gateLoading.hidden = true;
  el.gateLogin.hidden = true;
  el.gatePick.hidden = false;
  el.pickName.textContent = state.user.name;

  el.guildPick.textContent = '';
  state.guilds.forEach((g) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const marca = document.createElement('span');
    marca.className = 'avatar';
    paintAvatar(marca, g.name);
    const nome = document.createElement('strong');
    nome.textContent = g.name;
    b.append(marca, nome);
    if (g.isOwner) {
      const dono = document.createElement('small');
      dono.textContent = 'seu';
      b.appendChild(dono);
    }
    b.addEventListener('click', () => abrirServidor(g.id));
    li.appendChild(b);
    el.guildPick.appendChild(li);
  });

  // Último servidor usado volta selecionado.
  const ultimo = store.get('servidor', '');
  if (ultimo && state.guilds.some((g) => g.id === ultimo)) abrirServidor(ultimo);
}

el.newGuildBtn.addEventListener('click', async () => {
  const name = el.newGuildInput.value.trim();
  if (!name) return;
  el.newGuildBtn.disabled = true;
  el.pickError.textContent = '';
  try {
    const r = await api('/guilds', { method: 'POST', body: JSON.stringify({ name }) });
    await abrirServidor(r.guild.id);
  } catch (err) {
    el.pickError.textContent = err.message;
  } finally {
    el.newGuildBtn.disabled = false;
  }
});

el.inviteBtn.addEventListener('click', async () => {
  const code = el.inviteInput.value.trim().toUpperCase();
  if (!code) return;
  el.inviteBtn.disabled = true;
  el.pickError.textContent = '';
  try {
    const r = await api(`/invites/${encodeURIComponent(code)}/accept`, { method: 'POST' });
    await abrirServidor(r.guild.id);
  } catch (err) {
    el.pickError.textContent = err.message;
  } finally {
    el.inviteBtn.disabled = false;
  }
});

[el.newGuildInput, el.inviteInput].forEach((i) =>
  i.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    (i === el.newGuildInput ? el.newGuildBtn : el.inviteBtn).click();
  }));

/* --------------------------- abrir um servidor --------------------------- */

async function abrirServidor(guildId) {
  el.pickError.textContent = '';
  gateBusy('Abrindo o servidor…');

  let dados;
  try {
    dados = await api(`/guilds/${guildId}`);
  } catch (err) {
    el.gateStatus.hidden = true;
    el.pickError.textContent = err.message;
    return;
  }

  state.guild = dados.guild;
  state.channels = dados.channels;
  state.roles = dados.roles;
  state.myPerms = dados.me.permissions;
  state.guildMembers = new Map((dados.members || []).map((m) => [m.id, m]));
  store.set('servidor', guildId);

  if (!state.mic) {
    gateBusy('Liberando o microfone…');
    if (!navigator.mediaDevices?.getUserMedia) {
      el.gateStatus.hidden = true;
      el.pickError.textContent = 'Este navegador não libera microfone aqui. Use HTTPS ou http://localhost.';
      return;
    }
    try {
      state.mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
    } catch (err) {
      el.gateStatus.hidden = true;
      el.pickError.textContent = err?.name === 'NotAllowedError'
        ? 'Você bloqueou o microfone. Libere no cadeado da barra de endereço.'
        : 'Não deu para usar o microfone. Algum outro programa pode estar usando.';
      return;
    }
  }

  try {
    const res = await fetch('/ice-config');
    if (res.ok) state.ice = await res.json();
  } catch (_) { /* segue com o STUN padrão */ }

  // Trocar de servidor precisa limpar o anterior: gente, pares e conversa.
  if (state.joined || state.voiceChannel) {
    stopShare();
    tearDownRoom();
  }
  state.voiceChannel = null;
  state.textChannel = null;
  state.joined = false;
  state.messages.clear();
  state.lastMsg = null;
  state.channelVoice.clear(); // roster de voz é por servidor; o de outro fica atrás
  state.presentUserIds.clear();
  renderMemberList();
  el.log.textContent = '';
  clearUnread();

  el.gate.hidden = true;
  el.app.hidden = false;
  montarTela();
  conectar();
}

function montarTela() {
  el.roomName.textContent = state.guild.name;
  el.railInitials.textContent = initialsFor(state.guild.name);
  el.meName.textContent = state.user.name;
  paintAvatar(el.meAvatar, state.user.name);
  document.title = `${state.guild.name} · Concord`;

  startAudioContext();
  buildEmojiPop();
  buildStatusList();
  buildSoundboard();
  buildSoundTest();
  loadPrefs();
  syncPanes();
  desenharCanais();
  atualizarPalco();
}

/* Os canais vêm do servidor JÁ FILTRADOS por quem pode ver — canal trancado
 * não chega nem na lista, então não tem o que esconder aqui. */
function desenharCanais() {
  el.channels.textContent = '';
  state.rosterEls.clear();
  state.rosterMemberEls.clear();

  const grupo = (titulo) => {
    const h = document.createElement('h3');
    h.className = 'group-title';
    h.textContent = titulo;
    el.channels.appendChild(h);
  };

  const voz = state.channels.filter((c) => c.type === 'voice');
  const texto = state.channels.filter((c) => c.type === 'text');

  // Texto em cima, voz embaixo — pedido explicitamente.
  grupo('Canais de texto');
  texto.forEach((c) => el.channels.appendChild(itemCanal(c)));

  grupo('Canais de voz');
  voz.forEach((c) => {
    el.channels.appendChild(itemCanal(c));

    // Lista de quem está NESTE canal, presa embaixo do próprio botão —
    // não mais um único bloco compartilhado no fim de todos os canais.
    const roster = document.createElement('ul');
    roster.className = 'voice-members';
    roster.dataset.channelId = c.id;
    el.channels.appendChild(roster);
    state.rosterEls.set(c.id, roster);
    renderRoster(c.id); // repovoa de dados que já existiam antes deste redesenho
  });

  /* Só escolhe o canal; abrir de fato é o handler de `connect` que faz.
   * Buscar histórico aqui não funcionava: montarTela() roda antes de
   * conectar(), e o emit num socket inexistente sumia sem erro. */
  const aindaExiste = state.textChannel && texto.some((c) => c.id === state.textChannel);
  if (!aindaExiste && texto[0]) state.textChannel = texto[0].id;

  marcarAtivos();
  window.Concord?.mostrarAdmin?.();
}

function itemCanal(canal) {
  const b = document.createElement('button');
  b.className = 'channel';
  b.dataset.channelId = canal.id;
  b.dataset.type = canal.type;
  b.appendChild(icon(canal.type === 'voice' ? 'i-speaker' : 'i-hash'));

  const nome = document.createElement('span');
  nome.className = 'channel-name';
  nome.textContent = canal.name;
  b.appendChild(nome);

  if (canal.type === 'voice') {
    const selo = document.createElement('span');
    selo.className = 'live-badge';
    selo.textContent = 'ao vivo';
    setShown(selo, false);
    b.appendChild(selo);
    b.addEventListener('click', () => entrarNaVoz(canal.id));
  } else {
    const pilula = document.createElement('span');
    pilula.className = 'unread-pill';
    setShown(pilula, false);
    b.appendChild(pilula);
    b.addEventListener('click', () => { abrirTexto(canal.id); closeDrawers(); });
  }
  return b;
}

const itemDoCanal = (id) => el.channels.querySelector(`[data-channel-id="${CSS.escape(id)}"]`);

/* --------------------------- roster de voz por canal --------------------------- *
 * Fonte única de verdade para "quem está em cada canal de voz". Vive em
 * state.channelVoice, sobrevive a qualquer redesenho da lista de canais —
 * era isso que faltava: antes a lista de gente ficava presa a nós de DOM
 * que um redesenho destruía, e a pessoa "desaparecia" mesmo continuando
 * conectada. */

function rosterDoCanal(channelId) {
  if (!state.channelVoice.has(channelId)) state.channelVoice.set(channelId, new Map());
  return state.channelVoice.get(channelId);
}

function rosterUpsert(channelId, info) {
  if (!channelId) return;
  const mapa = rosterDoCanal(channelId);
  mapa.set(info.id, { ...mapa.get(info.id), ...info });
  renderRoster(channelId);
}

function rosterRemove(channelId, socketId) {
  if (!channelId) return;
  state.channelVoice.get(channelId)?.delete(socketId);
  renderRoster(channelId);
}

/* Atualiza meu próprio item no canal em que estou — coisas como mutar não
 * fazem ida e volta pelo servidor para o próprio autor. */
function meuRosterPatch(patch) {
  if (!state.voiceChannel) return;
  rosterUpsert(state.voiceChannel.id, {
    id: state.me.id, userId: state.user.id, name: state.me.name, avatar: state.user.avatar,
    ...rosterDoCanal(state.voiceChannel.id).get(state.me.id), ...patch
  });
}

function renderRoster(channelId) {
  const ul = state.rosterEls.get(channelId);
  if (!ul) return; // canal ainda não desenhado (ex.: chegou antes de montarTela)

  const pessoas = [...rosterDoCanal(channelId).values()];
  const avatares = new Map(); // socketId -> avatar, para tickMeters achar sem varrer o DOM
  ul.textContent = '';
  pessoas.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'vmember';
    li.dataset.id = p.id;

    const av = document.createElement('span');
    av.className = 'avatar avatar-sm';
    paintAvatar(av, p.name);

    const nome = document.createElement('span');
    nome.className = 'vmember-name';
    nome.textContent = p.userId === state.user?.id ? `${p.name} (você)` : p.name;

    const icons = document.createElement('span');
    icons.className = 'vmember-icons';
    if (p.sharing) icons.appendChild(icon('i-screen', 'vicon-share'));
    if (p.muted) icons.appendChild(icon('i-mic-off', 'vicon-mute'));
    if (p.deaf) icons.appendChild(icon('i-headset-off', 'vicon-mute'));

    li.append(av, nome, icons);
    ul.appendChild(li);
    avatares.set(p.id, av);

    // No MESMO canal em que estou: clique ajusta o volume da pessoa (como
    // antes, só que agora a partir do roster). Em outro canal: abre o
    // perfil, de onde dá para chamar a pessoa para esta chamada.
    li.addEventListener('click', () => {
      if (p.userId === state.user?.id) return;
      if (channelId === state.voiceChannel?.id) return openVolume(p.id, li);
      const guildMember = state.guildMembers.get(p.userId);
      if (guildMember) abrirPerfil(guildMember, li);
    });
  });
  state.rosterMemberEls.set(channelId, avatares);
}

function marcarAtivos() {
  el.channels.querySelectorAll('.channel').forEach((b) => {
    const id = b.dataset.channelId;
    b.classList.toggle('is-active',
      id === state.voiceChannel?.id || (state.view === 'chat' && id === state.textChannel));
  });
}

/* ------------------------------ conexão ------------------------------ */

function conectar() {
  /* Fecha o socket anterior antes de abrir outro. Sem isso, trocar de
   * servidor deixava os dois abertos ouvindo o mesmo canal, e cada mensagem
   * chegava — e era desenhada — duas vezes. */
  if (state.socket) {
    state.socket.removeAllListeners();
    state.socket.disconnect();
    state.socket = null;
  }

  // O token vai no aperto de mão: socket sem sessão válida nem conecta.
  const socket = io({ auth: { token: state.token }, timeout: 8000, reconnectionAttempts: 8 });
  state.socket = socket;

  socket.on('connect_error', (err) => {
    if (/sess|token|autentic/i.test(err.message || '')) {
      store.set('token', '');
      return toast('Sua sessão venceu. Recarregue a página para entrar de novo.');
    }
    toast('Não foi possível falar com o servidor.');
  });

  /* Reconexão: o socket.io volta sozinho, mas o id do socket muda e a malha
   * morreu. Se estávamos num canal de voz, voltamos para ele. */
  socket.on('connect', () => {
    setVoiceState(state.voiceChannel ? 'Voz conectada' : 'Fora do canal', Boolean(state.voiceChannel));
    // Vale para a primeira vez e para a volta depois de uma queda.
    if (state.guild) watchGuild(state.guild.id);
    if (state.textChannel) abrirTexto(state.textChannel);
    if (state.voiceChannel) entrarNaVoz(state.voiceChannel.id, true);
  });

  /* peer-joined/left/state agora chegam para o servidor INTEIRO, não só
   * para quem já está no canal — é o que a barra lateral precisa para
   * mostrar ocupantes de qualquer canal sem exigir entrar. O roster
   * (rosterUpsert/rosterRemove) é atualizado sempre; a parte "rica" — vídeo,
   * WebRTC, painel Online — continua só para o canal em que EU estou. */
  socket.on('peer-joined', (p) => {
    rosterUpsert(p.channelId, p);
    if (p.channelId !== state.voiceChannel?.id) return;

    upsertMember({ ...p, mine: false });
    ensurePeer(p.id, p.name);
    playSound('entrar');
    refreshCount();
  });

  socket.on('peer-left', ({ id, channelId }) => {
    rosterRemove(channelId, id);
    if (!state.members.has(id)) return; // não era do meu canal — nada de rico a limpar

    const peer = state.peers.get(id);
    if (peer) {
      peer.pc.close();
      peer.audioEls.forEach((a) => a.remove());
      state.peers.delete(id);
    }
    dropMember(id);
    playSound('sair');
    refreshCount();
  });

  socket.on('peer-state', ({ id, channelId, muted, sharing, deaf, screenId }) => {
    rosterUpsert(channelId, { id, muted, sharing, deaf });

    const m = state.members.get(id);
    if (!m) return;
    if (typeof muted === 'boolean') m.muted = muted;
    if (typeof sharing === 'boolean') m.sharing = sharing;
    if (typeof deaf === 'boolean') m.deaf = deaf;

    const oldScreenId = m.screenId;
    if (screenId !== undefined) m.screenId = screenId;
    // `removeTrack` do outro lado nem sempre dispara `ended` aqui, então quem
    // recolhe o áudio da transmissão encerrada é esta troca de estado.
    if (oldScreenId && oldScreenId !== m.screenId) dropAudioByStream(id, oldScreenId);

    const peer = state.peers.get(id);
    if (peer) { applyVolume(id); refreshMeter(peer); }

    paintMember(id);
    if (sharing === false) clearVideo(id);
    if (state.volumeTarget === id && !el.volumePop.hidden) {
      openVolume(id, state.nodes.get(id)?.tile || el.tiles);
    }
    updateLive();
  });

  socket.on('peer-presence', ({ id, status, note }) => {
    const m = state.members.get(id);
    if (!m) return;
    m.status = status; m.note = note;
    paintMember(id);
  });

  // Presença de SERVIDOR (app aberto, dentro ou fora de qualquer canal de
  // voz) — o que a coluna "Online" usa para separar quem está de verdade
  // conectado de quem só continua listado como membro do servidor.
  socket.on('presence-join', ({ userId }) => {
    state.presentUserIds.add(userId);
    renderMemberList();
  });
  socket.on('presence-leave', ({ userId }) => {
    state.presentUserIds.delete(userId);
    renderMemberList();
  });

  socket.on('call-incoming', (convite) => mostrarChamadaEntrante(convite));

  socket.on('signal', handleSignal);
  socket.on('chat', (m) => renderMessage(m));
  socket.on('voice-note', (m) => renderMessage(m));
  socket.on('image', (m) => renderMessage(m));
  socket.on('chat-edit', applyEdit);
  socket.on('chat-delete', applyDelete);
  socket.on('chat-react', applyReaction);
  socket.on('reaction', ({ emoji, name: who }) => floatEmoji(emoji, who));

  socket.on('nudge', ({ id, name: who }) => {
    shakeScreen();
    playSound('zumbido');
    if (id !== state.me?.id) system(`${who} mandou um zumbido`, 'in');
  });

  socket.on('soundboard', ({ name: who, label }) => system(`${who} tocou ${label}`, 'in'));

  socket.on('typing', ({ id, name: who }) => {
    if (id === state.me?.id) return;
    state.typers.set(id, { name: who, until: Date.now() + 3500 });
    paintTyping();
  });

  socket.io.on('reconnect_attempt', () => setVoiceState('Reconectando…', false));

  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') return;
    setVoiceState('Reconectando…', false);
    tearDownRoom(); // os pares morrem junto; a malha é remontada na volta
  });

  /* O servidor avisa quando recusa algo, em vez de ignorar em silêncio.
   * Sem isso, permissão negada aparece como "não funcionou" sem motivo. */
  socket.on('forced', (aviso) => {
    if (aviso.reason) toast(aviso.reason);
    if (aviso.sharing === false && state.screen) stopShare();
    if (aviso.muted === true) setMic(false, true);
    if (aviso.disconnected) sairDaVoz();
  });
}

/* Retrato de quem está em cada canal de voz do servidor, vindo direto do
 * servidor — é o que permite mostrar ocupantes de um canal sem ter
 * entrado nele. Chamado ao abrir o servidor e de novo em toda reconexão,
 * porque salas de socket.io não sobrevivem à queda. */
function watchGuild(guildId) {
  state.socket?.emit('watch-guild', { guildId }, (r) => {
    if (r?.error) return;
    Object.entries(r.channels || {}).forEach(([chId, pessoas]) => {
      const mapa = rosterDoCanal(chId);
      mapa.clear();
      pessoas.forEach((p) => mapa.set(p.id, p));
      renderRoster(chId);
    });
    state.presentUserIds = new Set(r.presentes || []);
    renderMemberList();
  });
}

/* --------------------------- chamar alguém para a voz --------------------------- */

/** Chama alguém do servidor que está online mas fora do canal — toca um
 * convite nos dispositivos dela; aceitar já entra direto no canal. */
function chamarParaVoz(userId, channelId) {
  state.socket?.emit('call-invite', { userId, channelId }, (r) => {
    if (r?.error) toast(r.error);
    else toast('Chamada enviada.', 'ok');
  });
}

let chamadaAtual = null;
let chamadaTimer = null;
let chamadaRingInterval = null;

function mostrarChamadaEntrante(convite) {
  chamadaAtual = convite;
  paintAvatar(el.callBannerAvatar, convite.from.name);
  el.callBannerName.textContent = `${convite.from.name} está te chamando`;
  el.callBannerChannel.textContent = `Canal de voz: ${convite.channel.name}`;
  el.callBanner.hidden = false;

  playSound('chamada');
  clearInterval(chamadaRingInterval);
  chamadaRingInterval = setInterval(() => playSound('chamada'), 1300);

  clearTimeout(chamadaTimer);
  chamadaTimer = setTimeout(esconderChamadaEntrante, 30000);
}

function esconderChamadaEntrante() {
  chamadaAtual = null;
  el.callBanner.hidden = true;
  clearInterval(chamadaRingInterval);
  clearTimeout(chamadaTimer);
}

el.callBannerAccept.addEventListener('click', async () => {
  const convite = chamadaAtual;
  if (!convite) return;
  esconderChamadaEntrante();
  if (state.guild?.id !== convite.channel.guildId) await abrirServidor(convite.channel.guildId);
  entrarNaVoz(convite.channel.id);
});

el.callBannerDecline.addEventListener('click', esconderChamadaEntrante);

/* --------------------------- entrar e sair da voz --------------------------- */

async function entrarNaVoz(channelId, religando) {
  if (!religando && state.voiceChannel?.id === channelId) return setView('stage');
  if (state.voiceChannel && !religando) sairDaVoz();

  const reply = await new Promise((resolve) => {
    state.socket.emit('join-voice', { channelId }, resolve);
    setTimeout(() => resolve({ error: 'O servidor não respondeu.' }), 10000);
  });

  if (reply?.error) {
    state.voiceChannel = null;
    return toast(reply.error);
  }

  state.me = reply.you;
  state.voiceChannel = reply.channel;
  state.joined = true;
  state.myPerms = reply.permissions;

  el.vsRoom.textContent = `${reply.channel.name} · ${state.guild.name}`;
  setVoiceState('Voz conectada', true);

  // Se o mic já entra mudo (push-to-talk, ou mudou antes de entrar), o
  // ícone de mudo precisa refletir isso desde o primeiro desenho — não só
  // depois que a pessoa clicar em mutar/desmutar uma vez.
  const micOn = state.mic?.getAudioTracks()[0]?.enabled !== false;

  upsertMember({
    id: state.me.id, name: state.me.name, muted: !micOn, sharing: false,
    deaf: false, status: state.status, note: state.note, mine: true
  });
  attachMeter(state.me.id, state.mic);

  /* Eu mesmo nunca chego por `peer-joined` (o servidor exclui o remetente
   * do broadcast) — então o roster deste canal só fica completo se eu me
   * incluir aqui, e reafirmar os pares por segurança caso o retrato do
   * `watch-guild` tenha chegado antes desta entrada existir. */
  rosterUpsert(channelId, {
    id: state.me.id, userId: state.user.id, name: state.me.name, avatar: state.user.avatar,
    muted: !micOn, sharing: false, deaf: state.deaf
  });

  reply.peers.forEach((p) => {
    upsertMember({ ...p, mine: false });
    ensurePeer(p.id, p.name);
    rosterUpsert(channelId, p);
  });

  state.socket.emit('state', { muted: !micOn, sharing: false, deaf: state.deaf, screenId: null });
  state.socket.emit('presence', { status: state.status, note: state.note });

  marcarAtivos();
  refreshCount();
  setView('stage');
  // Religando depois de uma queda não é "entrei agora" — não toca.
  atualizarPalco();
  if (!religando) playSound('conectou');
}

function sairDaVoz() {
  if (!state.voiceChannel) return;
  playSound('desconectou');
  stopShare();
  state.socket?.emit('leave-voice');
  rosterRemove(state.voiceChannel.id, state.me.id); // idem: não recebo peer-left de mim mesmo
  state.voiceChannel = null;
  state.joined = false;
  tearDownRoom();
  setVoiceState('Fora do canal', false);
  el.vsRoom.textContent = state.guild?.name || '—';
  atualizarPalco();
  marcarAtivos();
  setView('chat');
}

/* --------------------------- canal de texto --------------------------- */

async function abrirTexto(channelId) {
  state.textChannel = channelId;
  const canal = state.channels.find((c) => c.id === channelId);
  el.msgInput.placeholder = `Conversar em #${canal?.name || 'geral'}`;

  el.log.textContent = '';
  state.messages.clear();
  state.lastMsg = null;

  state.socket?.emit('watch', { channelId });

  const r = await new Promise((resolve) => {
    state.socket?.emit('history', { channelId }, resolve);
    setTimeout(() => resolve({}), 8000);
  });

  if (r?.error) return toast(r.error);
  (r?.messages || []).forEach((m) => renderMessage(m, true));
  if (r?.messages?.length) system('— fim do que já tinha sido dito —', 'in');

  setView('chat');
  marcarAtivos();
  const pilula = itemDoCanal(channelId)?.querySelector('.unread-pill');
  if (pilula) setShown(pilula, false);
}

// Derruba a malha e a lista de gente, mas preserva a conversa já escrita.
function tearDownRoom() {
  state.peers.forEach((p) => {
    p.pc.close();
    p.audioEls.forEach((a) => a.remove());
  });
  state.peers.clear();
  state.nodes.forEach((n) => { n.tile.remove(); });
  state.nodes.clear();
  state.members.clear();
  state.meters.clear();
  state.typers.clear();
  state.focused = null;
  el.tiles.dataset.focus = 'false';
  el.volumePop.hidden = true;
  paintTyping();
  refreshCount();
}

function setVoiceState(text, ok) {
  el.vsState.textContent = text;
  el.vsState.style.color = ok ? 'var(--online)' : 'var(--away)';
}

/* --------------------------- pessoas na sala --------------------------- */

function upsertMember(info) {
  const prev = state.members.get(info.id);
  const m = Object.assign(
    { muted: false, sharing: false, deaf: false, status: 'online', note: '', mine: false },
    prev, info
  );
  state.members.set(m.id, m);
  if (!state.nodes.has(m.id)) state.nodes.set(m.id, buildNodes(m));
  paintMember(m.id);
  updateLive();
}

function dropMember(id) {
  const n = state.nodes.get(id);
  if (n) { n.tile.remove(); }
  state.nodes.delete(id);
  state.members.delete(id);
  state.meters.delete(id);
  if (state.focused === id) setFocus(null);
  if (state.volumeTarget === id) el.volumePop.hidden = true;
  updateTiles();
  updateLive();
}

function buildNodes(m) {
  const label = m.mine ? `${m.name} (você)` : m.name;

  /* quadro no palco */
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.id = m.id;
  tile.dataset.video = 'false';

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true; // o áudio da tela chega pelo elemento <audio> do par

  const face = document.createElement('div');
  face.className = 'tile-face';
  const tavatar = document.createElement('span');
  tavatar.className = 'avatar avatar-lg';
  const twho = document.createElement('span');
  twho.className = 'tile-who';
  twho.textContent = label;
  face.append(tavatar, twho);

  const tlabel = document.createElement('div');
  tlabel.className = 'tile-label';
  const tmute = icon('i-mic-off');
  setShown(tmute, false);
  const tname = document.createElement('span');
  tname.className = 'tile-label-name';
  tname.textContent = label;
  tlabel.append(tmute, tname);

  const full = document.createElement('button');
  full.className = 'tile-full';
  full.title = 'Tela cheia';
  full.appendChild(icon('i-expand'));
  full.addEventListener('click', (e) => {
    e.stopPropagation(); // senão o clique também troca o destaque
    if (document.fullscreenElement) document.exitFullscreen();
    else tile.requestFullscreen?.();
  });

  let tvolume = null;
  if (!m.mine) {
    tvolume = document.createElement('button');
    tvolume.className = 'tile-volume';
    tvolume.title = 'Volume desta transmissão';
    tvolume.appendChild(icon('i-speaker'));
    tvolume.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!hasLiveAudio(m.id)) {
        return toast('Esta transmissão veio sem som — quem transmite precisa marcar "compartilhar áudio".');
      }
      openVolume(m.id, tvolume);
    });
    tile.appendChild(tvolume);
  }

  tile.addEventListener('click', () => {
    if (tile.dataset.video !== 'true') return;
    setFocus(state.focused === m.id ? null : m.id);
  });

  tile.append(video, face, tlabel, full);
  el.tiles.appendChild(tile);

  paintAvatar(tavatar, m.name);

  updateTiles();
  return { tile, video, tmute, tvolume };
}

function paintMember(id) {
  const m = state.members.get(id);
  const n = state.nodes.get(id);
  if (!m || !n) return;

  // Estado de canal de voz: agora só no palco — a lista lateral por canal
  // é o roster (renderRoster), que não depende de sessão rica nenhuma.
  setShown(n.tmute, m.muted === true);
}

function refreshCount() {
  const n = state.members.size;
  el.viewSub.textContent = state.view === 'stage' && state.voiceChannel
    ? `${n} ${n === 1 ? 'pessoa' : 'pessoas'} no canal` : '';
}

/* --------------------------- lista do servidor --------------------------- */

/* A coluna da direita mostra TODO MUNDO do servidor, agrupado por cargo —
 * não só quem está numa chamada de voz. "Online" aqui é presença de app
 * aberto (state.presentUserIds), não presença de voz. */
function renderMemberList() {
  if (!el.membersPane) return;
  el.membersPane.textContent = '';

  const membros = [...state.guildMembers.values()];
  if (!membros.length) return;

  const cargos = [...state.roles].filter((r) => !r.isEveryone).sort((a, b) => b.position - a.position);
  const porCargo = new Map();
  const semCargo = [];

  membros.forEach((m) => {
    const meuCargo = cargos.find((r) => m.roleIds?.includes(r.id));
    if (meuCargo) {
      if (!porCargo.has(meuCargo.id)) porCargo.set(meuCargo.id, []);
      porCargo.get(meuCargo.id).push(m);
    } else {
      semCargo.push(m);
    }
  });

  const ordenados = (lista) => lista.slice().sort((a, b) => {
    const onA = state.presentUserIds.has(a.id), onB = state.presentUserIds.has(b.id);
    if (onA !== onB) return onA ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  function grupo(titulo, lista, cor) {
    if (!lista.length) return;
    const h = document.createElement('h3');
    h.className = 'group-title';
    if (cor) {
      const dot = document.createElement('span');
      dot.className = 'role-dot';
      dot.style.background = cor;
      h.appendChild(dot);
    }
    h.appendChild(document.createTextNode(`${titulo} — ${lista.length}`));
    el.membersPane.appendChild(h);

    const ul = document.createElement('ul');
    ul.className = 'member-list';
    ordenados(lista).forEach((m) => ul.appendChild(itemMembro(m)));
    el.membersPane.appendChild(ul);
  }

  cargos.forEach((r) => grupo(r.name, porCargo.get(r.id) || [], r.color));
  grupo('Membros', semCargo, null);
}

function itemMembro(m) {
  const online = state.presentUserIds.has(m.id);

  const li = document.createElement('li');
  li.className = 'member-row';
  li.dataset.online = String(online);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'member';

  const av = document.createElement('span');
  av.className = 'avatar';
  paintAvatar(av, m.name);

  const nome = document.createElement('span');
  nome.className = 'member-name';
  nome.textContent = m.id === state.user?.id ? `${m.name} (você)` : m.name;

  btn.append(av, nome);
  li.appendChild(btn);
  btn.addEventListener('click', () => abrirPerfil(m, btn));
  return li;
}

/** Verdadeiro se essa pessoa está no MESMO canal de voz em que eu estou. */
function estaNoMeuCanal(userId) {
  if (!state.voiceChannel) return false;
  return [...rosterDoCanal(state.voiceChannel.id).values()].some((p) => p.userId === userId);
}

function abrirPerfil(m, anchor) {
  paintAvatar(el.profileAvatar, m.name);
  el.profileName.textContent = m.id === state.user?.id ? `${m.name} (você)` : m.name;

  const online = state.presentUserIds.has(m.id);
  el.profileStatus.textContent = online ? 'Online' : 'Offline';
  el.profileStatus.dataset.online = String(online);

  el.profileRoles.textContent = '';
  state.roles
    .filter((r) => !r.isEveryone && m.roleIds?.includes(r.id))
    .forEach((r) => {
      const li = document.createElement('li');
      li.className = 'role-pill';
      const dot = document.createElement('span');
      dot.className = 'role-dot';
      dot.style.background = r.color || 'var(--line)';
      li.append(dot, document.createTextNode(r.name));
      el.profileRoles.appendChild(li);
    });

  const podeChamar = m.id !== state.user?.id && online && Boolean(state.voiceChannel) && !estaNoMeuCanal(m.id);
  setShown(el.profileCallBtn, podeChamar);
  el.profileCallBtn.onclick = () => {
    chamarParaVoz(m.id, state.voiceChannel.id);
    el.profilePop.hidden = true;
  };

  el.profilePop.hidden = false;
  if (isNarrow()) {
    el.profilePop.style.left = ''; el.profilePop.style.top = '';
    return;
  }
  const r = anchor.getBoundingClientRect();
  const pop = el.profilePop.getBoundingClientRect();
  el.profilePop.style.left = `${Math.max(8, Math.min(r.left - pop.width - 8, innerWidth - pop.width - 8))}px`;
  el.profilePop.style.top = `${Math.max(8, Math.min(r.top, innerHeight - pop.height - 8))}px`;
}

function updateTiles() {
  el.tiles.dataset.solo = String(el.tiles.children.length === 1 && !state.focused);
  atualizarPalco();
}

/* Fora de um canal de voz, o palco não tem o que mostrar e os botões dele
 * não fazem nada. Melhor dizer isso do que oferecer botão que engana. */
function atualizarPalco() {
  const naVoz = Boolean(state.voiceChannel);
  setShown(el.stageEmpty, !naVoz);
  el.tiles.hidden = !naVoz;
  [el.stageShareBtn, el.stageMicBtn, el.stageLeaveBtn, el.shareBtn].forEach((b) => {
    if (b) b.disabled = !naVoz;
  });
}

function updateLive() {
  const live = [...state.members.values()].some((m) => m.sharing);
  const selo = state.voiceChannel && itemDoCanal(state.voiceChannel.id)?.querySelector('.live-badge');
  if (selo) setShown(selo, live);
}

function setFocus(id) {
  state.focused = id;
  el.tiles.dataset.focus = String(!!id);
  state.nodes.forEach((n, key) => { n.tile.dataset.focused = String(key === id); });
  updateTiles();
}

/* --------------------------- status e recado --------------------------- */

function buildStatusList() {
  el.statusList.textContent = '';
  STATUSES.forEach((s) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'status-opt';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.style.background = s.color;
    b.append(dot, document.createTextNode(s.label));
    b.addEventListener('click', () => { setStatus(s.id); el.statusPop.hidden = true; });
    li.appendChild(b);
    el.statusList.appendChild(li);
    s.node = b;
  });
  paintStatusList();
}

function paintStatusList() {
  STATUSES.forEach((s) => s.node?.setAttribute('aria-checked', String(s.id === state.status)));
  const cur = STATUSES.find((s) => s.id === state.status);
  el.meNote.textContent = state.note || cur?.label.toLowerCase() || '';
}

function setStatus(id, auto) {
  state.status = id;
  if (!auto) {
    state.statusBeforeAway = null;
    store.set('status', id);
  }
  const me = state.members.get(state.me?.id);
  if (me) { me.status = id; paintMember(me.id); }
  state.socket?.emit('presence', { status: id, note: state.note });
  paintStatusList();
}

el.meCard.addEventListener('click', (e) => { e.stopPropagation(); openStatus(); });

function openStatus() {
  el.noteInput.value = state.note;
  paintStatusList();
  el.statusPop.hidden = false;

  if (isNarrow()) { el.statusPop.style.left = ''; el.statusPop.style.top = ''; return; }
  const r = el.meCard.getBoundingClientRect();
  const pop = el.statusPop.getBoundingClientRect();
  el.statusPop.style.left = `${Math.max(8, r.left)}px`;
  el.statusPop.style.top = `${Math.max(8, r.top - pop.height - 8)}px`;
}

el.noteInput.addEventListener('change', () => {
  state.note = el.noteInput.value.trim().slice(0, 80);
  store.set('recado', state.note);
  const me = state.members.get(state.me?.id);
  if (me) { me.note = state.note; paintMember(me.id); }
  state.socket?.emit('presence', { status: state.status, note: state.note });
  paintStatusList();
});

/* Ausente automático. Status que só muda na mão sempre mente — é isso que
 * faz o do Messenger ser confiável. */
const AWAY_AFTER = 5 * 60 * 1000;

['keydown', 'pointerdown', 'pointermove', 'wheel'].forEach((ev) => {
  document.addEventListener(ev, () => {
    state.lastActivity = Date.now();
    if (state.statusBeforeAway) {
      const back = state.statusBeforeAway;
      state.statusBeforeAway = null;
      setStatus(back, true);
    }
  }, { passive: true });
});

setInterval(() => {
  if (!state.joined || !state.autoAway) return;
  if (state.statusBeforeAway) return;
  if (state.status === 'ausente' || state.status === 'invisivel') return;
  if (Date.now() - state.lastActivity < AWAY_AFTER) return;
  state.statusBeforeAway = state.status;
  setStatus('ausente', true);
}, 20000);

/* --------------------------- volume e conexão --------------------------- */

function volumeOf(id) {
  if (!state.volumes.has(id)) {
    state.volumes.set(id, { voice: 100, quietVoice: false, live: 100, quietLive: false });
  }
  return state.volumes.get(id);
}

/* A voz e o som da transmissão chegam pela mesma conexão, mas em
 * MediaStreams diferentes. Quem transmite avisa o id da stream da tela;
 * com isso quem assiste separa os dois e regula cada um por conta. */
function kindOf(id, audio) {
  const screenId = state.members.get(id)?.screenId;
  return screenId && audio.dataset.streamId === screenId ? 'live' : 'mic';
}

function hasLiveAudio(id) {
  return !!state.peers.get(id)?.audioEls.some((a) => kindOf(id, a) === 'live');
}

function applyVolume(id) {
  const peer = state.peers.get(id);
  if (!peer) return;

  const v = volumeOf(id);
  peer.audioEls.forEach((a) => {
    const live = kindOf(id, a) === 'live';
    a.dataset.kind = live ? 'live' : 'mic';
    a.volume = (live ? v.live : v.voice) / 100;
    a.muted = state.deaf || (live ? v.quietLive : v.quietVoice);
  });

  const n = state.nodes.get(id);
  if (n?.tvolume) n.tvolume.dataset.quiet = String(v.quietLive || v.live === 0);
}

function applyAllVolumes() { state.peers.forEach((_, id) => applyVolume(id)); }

function dropAudioByStream(id, streamId) {
  const peer = state.peers.get(id);
  if (!peer) return;
  peer.audioEls = peer.audioEls.filter((a) => {
    if (a.dataset.streamId !== streamId) return true;
    a.srcObject = null;
    a.remove();
    if (peer.meterAudio === a) peer.meterAudio = null;
    return false;
  });
}

// O anel de "está falando" tem que ler a voz, não o som do jogo.
function refreshMeter(peer) {
  const mic = peer.audioEls.find((a) => kindOf(peer.id, a) === 'mic');
  if (!mic || peer.meterAudio === mic) return;
  peer.meterAudio = mic;
  state.meters.delete(peer.id);
  attachMeter(peer.id, mic.srcObject);
}

function openVolume(id, anchor) {
  const m = state.members.get(id);
  if (!m) return;

  state.volumeTarget = id;
  const v = volumeOf(id);
  el.volumeName.textContent = m.name;
  el.volumeRange.value = String(v.voice);
  el.volumeValue.textContent = String(v.voice);
  el.volumeMute.checked = v.quietVoice;

  const live = hasLiveAudio(id);
  el.liveSection.hidden = !live;
  el.liveNone.hidden = live || !m.sharing;
  if (live) {
    el.liveRange.value = String(v.live);
    el.liveValue.textContent = String(v.live);
    el.liveMute.checked = v.quietLive;
  }
  paintStats(id);
  el.volumePop.hidden = false;

  // No celular o painel é folha colada embaixo, posicionada pelo CSS.
  if (isNarrow()) { el.volumePop.style.left = ''; el.volumePop.style.top = ''; return; }

  const r = anchor.getBoundingClientRect();
  const pop = el.volumePop.getBoundingClientRect();
  el.volumePop.style.left = `${Math.max(8, Math.min(r.left - pop.width - 8, innerWidth - pop.width - 8))}px`;
  el.volumePop.style.top = `${Math.max(8, Math.min(r.top, innerHeight - pop.height - 8))}px`;
}

el.volumeRange.addEventListener('input', () => {
  if (!state.volumeTarget) return;
  volumeOf(state.volumeTarget).voice = Number(el.volumeRange.value);
  el.volumeValue.textContent = el.volumeRange.value;
  applyVolume(state.volumeTarget);
  paintMember(state.volumeTarget);
});
el.volumeMute.addEventListener('change', () => {
  if (!state.volumeTarget) return;
  volumeOf(state.volumeTarget).quietVoice = el.volumeMute.checked;
  applyVolume(state.volumeTarget);
  paintMember(state.volumeTarget);
});
el.liveRange.addEventListener('input', () => {
  if (!state.volumeTarget) return;
  volumeOf(state.volumeTarget).live = Number(el.liveRange.value);
  el.liveValue.textContent = el.liveRange.value;
  applyVolume(state.volumeTarget);
});
el.liveMute.addEventListener('change', () => {
  if (!state.volumeTarget) return;
  volumeOf(state.volumeTarget).quietLive = el.liveMute.checked;
  applyVolume(state.volumeTarget);
});

/* Qualidade da conexão: responde a pergunta eterna de "é você que está
 * travando ou sou eu?", e avisa quando o tráfego está passando por TURN. */
async function pollStats() {
  for (const peer of state.peers.values()) {
    try {
      const report = await peer.pc.getStats();
      let rtt = null, relay = false, lost = 0, received = 0, jitter = 0;

      report.forEach((s) => {
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated !== false) {
          if (typeof s.currentRoundTripTime === 'number') rtt = s.currentRoundTripTime * 1000;
          const local = report.get(s.localCandidateId);
          const remote = report.get(s.remoteCandidateId);
          if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') relay = true;
        }
        if (s.type === 'inbound-rtp' && s.kind === 'audio') {
          lost += s.packetsLost || 0;
          received += s.packetsReceived || 0;
          jitter = Math.max(jitter, (s.jitter || 0) * 1000);
        }
      });

      const prev = peer.stats || { lost: 0, received: 0 };
      const dLost = Math.max(0, lost - prev.lost);
      const dRecv = Math.max(0, received - prev.received);
      const loss = dRecv + dLost > 0 ? (dLost / (dRecv + dLost)) * 100 : 0;

      peer.stats = { lost, received, rtt, jitter, loss, relay };
    } catch (_) { /* conexão morrendo, ignora */ }
  }
  if (!el.volumePop.hidden && state.volumeTarget) paintStats(state.volumeTarget);
}
setInterval(() => { if (state.joined) pollStats(); }, 3000);

function paintStats(id) {
  const s = state.peers.get(id)?.stats;
  if (!s) { el.statsLine.textContent = 'medindo…'; return; }

  const grade = (v, ok, warn) => (v == null ? 'good' : v <= ok ? 'good' : v <= warn ? 'warn' : 'bad');
  el.statsLine.textContent = '';

  const add = (label, value, cls) => {
    const b = document.createElement('b');
    b.textContent = label;
    const v = document.createElement('span');
    v.className = cls;
    v.textContent = ` ${value}`;
    el.statsLine.append(b, v, document.createElement('br'));
  };

  add('ping', s.rtt == null ? '—' : `${Math.round(s.rtt)} ms`, grade(s.rtt, 80, 180));
  add('perda', `${s.loss.toFixed(1)} %`, grade(s.loss, 1, 5));
  add('jitter', `${Math.round(s.jitter)} ms`, grade(s.jitter, 20, 50));
  if (s.relay) {
    const w = document.createElement('span');
    w.className = 'warn';
    w.textContent = 'passando por TURN — pode pesar';
    el.statsLine.appendChild(w);
  }
}

/* --------------------------- pares WebRTC --------------------------- */

function ensurePeer(id, name) {
  if (state.peers.has(id)) return state.peers.get(id);

  const pc = new RTCPeerConnection(state.ice);
  const peer = {
    id, name, pc,
    polite: state.me.id > id,
    makingOffer: false, ignoreOffer: false,
    screenSenders: [], audioEls: [], meterAudio: null, stats: null
  };
  state.peers.set(id, peer);

  // Vai a mistura, não o microfone cru: assim trocar de microfone ou tocar
  // um som não mexe na faixa que os pares já estão recebendo.
  state.outStream.getAudioTracks().forEach((t) => pc.addTrack(t, state.outStream));
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
  pc.ontrack = ({ track, streams }) => {
    if (track.kind === 'video') receiveScreen(peer, track);
    else receiveAudio(peer, track, streams?.[0]?.id || '');
  };

  return peer;
}

async function handleSignal({ from, description, candidate }) {
  const peer = state.peers.get(from) || ensurePeer(from, state.members.get(from)?.name || 'alguém');
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

function receiveAudio(peer, track, streamId) {
  const stream = new MediaStream([track]);
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.srcObject = stream;
  audio.dataset.streamId = streamId; // é o que separa voz de transmissão
  el.audios.appendChild(audio);
  peer.audioEls.push(audio);

  if (state.sinkId && audio.setSinkId) audio.setSinkId(state.sinkId).catch(() => {});
  applyVolume(peer.id);
  refreshMeter(peer);

  // Se o navegador barrar a reprodução automática, a pessoa fica sem ouvir
  // ninguém e nada explica o porquê — daí o aviso clicável.
  audio.play().catch(() => { el.audioUnlock.hidden = false; });

  track.addEventListener('ended', () => {
    audio.remove();
    peer.audioEls = peer.audioEls.filter((a) => a !== audio);
    if (peer.meterAudio === audio) peer.meterAudio = null;
    refreshMeter(peer);
  });
}

el.audioUnlock.addEventListener('click', () => {
  state.audioCtx?.resume();
  el.audios.querySelectorAll('audio').forEach((a) => a.play().catch(() => {}));
  el.audioUnlock.hidden = true;
  toast('Som liberado.', 'ok');
});

/* --------------------------- transmissão de tela --------------------------- */

[el.shareBtn, el.stageShareBtn].forEach((b) => {
  b.addEventListener('click', () => (state.screen ? stopShare() : startShare()));
});

async function startShare() {
  /* Transmitir depende de estar num canal de voz: é por ele que a malha
   * WebRTC existe. Sem isso, dava para abrir o seletor de tela e ficar
   * "transmitindo" para ninguém — o servidor descartava calado e a pessoa
   * não entendia por que a tela não aparecia para o grupo. */
  if (!state.voiceChannel) {
    return toast('Entre num canal de voz primeiro — é por ele que a tela viaja.');
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return toast('Este navegador não transmite tela. Use Chrome, Edge ou Firefox no computador.');
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: QUALITY[state.quality] || QUALITY['1080'], audio: true
    });
  } catch (_) {
    return; // a pessoa fechou o seletor
  }

  state.screen = stream;
  state.peers.forEach((peer) => {
    stream.getTracks().forEach((t) => peer.screenSenders.push(peer.pc.addTrack(t, stream)));
  });

  stream.getVideoTracks()[0].addEventListener('ended', stopShare);
  showVideo(state.me.id, stream);

  paintShareButtons(true);
  state.socket.emit('state', { sharing: true, screenId: stream.id });
  const me = state.members.get(state.me.id);
  if (me) { me.sharing = true; me.screenId = stream.id; paintMember(me.id); }
  meuRosterPatch({ sharing: true });
  updateLive();
  setView('stage');

  if (!stream.getAudioTracks().length) {
    toast('Transmitindo sem som. Para mandar o áudio junto, marque "compartilhar áudio" no seletor.');
  }
}

function stopShare() {
  if (!state.screen) return;

  state.screen.getTracks().forEach((t) => t.stop());
  state.peers.forEach((peer) => {
    peer.screenSenders.forEach((s) => { try { peer.pc.removeTrack(s); } catch (_) {} });
    peer.screenSenders = [];
  });
  state.screen = null;
  clearVideo(state.me.id);

  paintShareButtons(false);
  state.socket.emit('state', { sharing: false, screenId: null });
  const me = state.members.get(state.me.id);
  if (me) { me.sharing = false; me.screenId = null; paintMember(me.id); }
  meuRosterPatch({ sharing: false });
  updateLive();
}

function paintShareButtons(live) {
  el.shareBtn.dataset.live = String(live);
  el.shareBtn.querySelector('span').textContent = live ? 'Parar transmissão' : 'Transmitir tela';
  el.stageShareLabel.textContent = live ? 'Parar' : 'Transmitir tela';
  el.stageShareBtn.dataset.on = live ? 'false' : 'true';
}

function receiveScreen(peer, track) {
  showVideo(peer.id, new MediaStream([track]));
  const m = state.members.get(peer.id);
  if (m) { m.sharing = true; paintMember(peer.id); }
  updateLive();
  setView('stage');

  track.addEventListener('ended', () => {
    clearVideo(peer.id);
    const mm = state.members.get(peer.id);
    if (mm) { mm.sharing = false; paintMember(peer.id); }
    updateLive();
  });
}

function showVideo(id, stream) {
  const n = state.nodes.get(id);
  if (!n) return;
  n.video.srcObject = stream;
  n.video.play().catch(() => {});
  n.tile.dataset.video = 'true';
  updateTiles();
}

function clearVideo(id) {
  const n = state.nodes.get(id);
  if (!n) return;
  n.video.srcObject = null;
  n.tile.dataset.video = 'false';
  if (state.focused === id) setFocus(null);
  updateTiles();
}

el.qualitySelect.addEventListener('change', async () => {
  state.quality = el.qualitySelect.value;
  store.set('qualidade', state.quality);

  const track = state.screen?.getVideoTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints(QUALITY[state.quality]);
    toast('Qualidade da transmissão ajustada.', 'ok');
  } catch (_) {
    toast('Este navegador não deixa mudar a qualidade no meio. Pare e recomece a transmissão.');
  }
});

/* ------------------------ áudio: mistura e sons ------------------------ */

function startAudioContext() {
  if (state.audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  state.audioCtx = new Ctx();
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

  // Tudo que sai daqui passa por este ponto: microfone e sons da soundboard.
  state.mixDest = state.audioCtx.createMediaStreamDestination();
  state.outStream = state.mixDest.stream;
  
  // Supressão de ruído em duas etapas: RNNoise (rede neural, remove ruído
  // misturado com a voz) seguido do noise gate (corta o silêncio de vez).
  // Cada módulo carrega de forma independente — se um falhar, a cadeia usa
  // só o que deu certo em vez de desistir da supressão inteira.
  if (state.audioCtx.audioWorklet) {
    // fetch() não existe dentro do AudioWorkletGlobalScope — os bytes do
    // .wasm precisam ser buscados aqui fora e entregues prontos ao worklet.
    Promise.all([
      state.audioCtx.audioWorklet.addModule('/lib/rnnoise-processor.js'),
      fetch('/lib/rnnoise.wasm').then((r) => r.arrayBuffer())
    ]).then(([, wasmBytes]) => {
      state.rnnoiseWasmBytes = wasmBytes;
      state.rnnoiseWorkletLoaded = true;
      connectMicToMix();
    }).catch(e => {
      console.error('Erro ao carregar o RNNoise:', e);
    });
    state.audioCtx.audioWorklet.addModule('/lib/noise-processor.js').then(() => {
      state.noiseWorkletLoaded = true;
      connectMicToMix();
    }).catch(e => {
      console.error('Erro ao carregar o noise gate:', e);
      connectMicToMix();
    });
  } else {
    connectMicToMix();
  }

  requestAnimationFrame(tickMeters);
}

function connectMicToMix() {
  if (!state.audioCtx || !state.mic) return;
  try { state.micSource?.disconnect(); } catch (_) {}
  try { state.rnnoiseNode?.disconnect(); } catch (_) {}
  try { state.noiseNode?.disconnect(); } catch (_) {}

  state.micSource = state.audioCtx.createMediaStreamSource(state.mic);

  let ultimoNo = state.micSource;

  if (state.noiseSuppression && state.rnnoiseWorkletLoaded) {
    if (!state.rnnoiseNode) {
      state.rnnoiseNode = new AudioWorkletNode(state.audioCtx, 'rnnoise-denoiser', {
        processorOptions: { wasmBinary: state.rnnoiseWasmBytes }
      });
    }
    ultimoNo.connect(state.rnnoiseNode);
    ultimoNo = state.rnnoiseNode;
  }

  if (state.noiseSuppression && state.noiseWorkletLoaded) {
    if (!state.noiseNode) {
      state.noiseNode = new AudioWorkletNode(state.audioCtx, 'noise-gate-processor');
    }
    try { state.noiseNode.port.postMessage({ threshold: getNoiseThreshold() }); } catch (_) {}
    ultimoNo.connect(state.noiseNode);
    ultimoNo = state.noiseNode;
  }

  ultimoNo.connect(state.mixDest);
  state.audioOutNode = ultimoNo;

  if (testVoiceActive) {
    updateTestVoiceRoute();
  }
}

function getNoiseThreshold() {
  const val = Number(state.noiseThreshold) || 20;
  return Number((val / 1000).toFixed(4));
}

function setNoiseThreshold(val) {
  state.noiseThreshold = Math.max(1, Math.min(100, Number(val) || 20));
  store.set('noise_threshold', String(state.noiseThreshold));

  if (el.noiseThresholdRange) el.noiseThresholdRange.value = state.noiseThreshold;
  if (el.noiseThresholdVal) el.noiseThresholdVal.textContent = `${state.noiseThreshold}%`;
  if (el.thresholdMarker) el.thresholdMarker.style.left = `${state.noiseThreshold}%`;

  const thresh = getNoiseThreshold();
  if (state.noiseNode) {
    try { state.noiseNode.port.postMessage({ threshold: thresh }); } catch (_) {}
  }
  if (testMeter?.testNoiseNode) {
    try { testMeter.testNoiseNode.port.postMessage({ threshold: thresh }); } catch (_) {}
  }
}

function updateNoiseSensitivityUI() {
  if (!el.noiseSensitivityRow) return;
  el.noiseSensitivityRow.classList.toggle('is-disabled', !state.noiseSuppression);
  if (el.thresholdMarker) {
    el.thresholdMarker.style.display = state.noiseSuppression ? 'block' : 'none';
  }
}

/* ----------------------- teste de retorno de voz ----------------------- */

let testVoiceActive = false;
let testVoiceGain = null;

function toggleTestVoice() {
  if (testVoiceActive) {
    stopTestVoice();
  } else {
    startTestVoice();
  }
}

function startTestVoice() {
  if (!state.audioCtx || !state.mic) {
    return toast('Microfone não disponível para teste.');
  }
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }

  testVoiceActive = true;
  if (el.testVoiceBtn) {
    el.testVoiceBtn.classList.add('is-active');
    el.testVoiceBtn.querySelector('span').textContent = 'Parar de ouvir';
  }

  if (!testVoiceGain) {
    testVoiceGain = state.audioCtx.createGain();
    testVoiceGain.gain.value = 1.0;
  }

  updateTestVoiceRoute();
  toast('Você está ouvindo sua voz. Use fones para evitar microfonia!', 'ok');
}

function stopTestVoice() {
  if (!testVoiceActive) return;
  testVoiceActive = false;

  if (el.testVoiceBtn) {
    el.testVoiceBtn.classList.remove('is-active');
    el.testVoiceBtn.querySelector('span').textContent = 'Testar minha voz';
  }

  if (testVoiceGain) {
    try { testVoiceGain.disconnect(); } catch (_) {}
  }
  try { state.rnnoiseNode?.disconnect(testVoiceGain); } catch (_) {}
  try { state.noiseNode?.disconnect(testVoiceGain); } catch (_) {}
  try { state.micSource?.disconnect(testVoiceGain); } catch (_) {}
}

function updateTestVoiceRoute() {
  if (!testVoiceActive || !state.audioCtx || !testVoiceGain) return;

  try { state.rnnoiseNode?.disconnect(testVoiceGain); } catch (_) {}
  try { state.noiseNode?.disconnect(testVoiceGain); } catch (_) {}
  try { state.micSource?.disconnect(testVoiceGain); } catch (_) {}
  try { testVoiceGain.disconnect(); } catch (_) {}

  testVoiceGain.connect(state.audioCtx.destination);

  if (state.audioOutNode) state.audioOutNode.connect(testVoiceGain);
}

/* ------------------------------ sons ------------------------------ *
 * Nenhum arquivo de áudio no projeto: tudo sintetizado na hora.
 *
 * O que dá a cara de Messenger é o TIMBRE. Onda senoidal pura soa a
 * despertador barato; o MSN usava sino, com ataque brilhante e cauda
 * curta. Sino se faz por FM: uma portadora modulada por outra numa razão
 * NÃO inteira, com o índice de modulação caindo mais rápido que o som.
 * Razão inteira daria órgão; é a irracional que soa metal.
 * ------------------------------------------------------------------ */

// Notas com nome, para as sequências ficarem legíveis.
const NOTA = {
  A3: 220, C4: 261.63, E4: 329.63, A4: 440, C5: 523.25, E5: 659.25,
  G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5
};

/* Tudo passa por este ganho antes de sair: um ponto só para regular o
 * volume geral — e o lugar onde um teste consegue medir se saiu som. */
function saidaDeSons() {
  if (!state.audioCtx) return null;
  if (!state.somGain) {
    state.somGain = state.audioCtx.createGain();
    state.somGain.gain.value = 1;
    state.somGain.connect(state.audioCtx.destination);
  }
  return state.somGain;
}

/**
 * Uma badalada de sino, por FM.
 * @param destino  nó de saída
 * @param freq     nota
 * @param quando   segundos a partir de agora
 * @param dur      quanto a cauda leva para morrer
 * @param vol      pico
 * @param brilho   índice de modulação: mais alto, mais metálico
 */
function sino(destino, freq, quando, dur, vol, brilho = 3) {
  const ctx = state.audioCtx;
  const t = ctx.currentTime + quando;

  const portadora = ctx.createOscillator();
  const modulador = ctx.createOscillator();
  const indice = ctx.createGain();
  const env = ctx.createGain();

  portadora.frequency.value = freq;
  modulador.frequency.value = freq * 1.41;   // razão irracional: sino, não órgão

  // O brilho morre antes do som — é isso que dá a "batida" do metal.
  indice.gain.setValueAtTime(freq * brilho, t);
  indice.gain.exponentialRampToValueAtTime(freq * 0.01, t + dur * 0.45);

  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vol, t + 0.006);   // ataque quase instantâneo
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  modulador.connect(indice).connect(portadora.frequency);
  portadora.connect(env).connect(destino);

  modulador.start(t); portadora.start(t);
  modulador.stop(t + dur); portadora.stop(t + dur);
}

/** Tom simples, para o que não é sino: buzina, tambor, zumbido. */
function tom(destino, { freq, para, quando, dur, vol, tipo = 'sine' }) {
  const ctx = state.audioCtx;
  const t = ctx.currentTime + quando;

  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(freq, t);
  if (para) osc.frequency.exponentialRampToValueAtTime(para, t + dur * 0.9);

  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(env).connect(destino);
  osc.start(t);
  osc.stop(t + dur);
}

/* Os avisos da sala. Subindo = alguém chegou, descendo = alguém saiu — é a
 * gramática do Messenger, e ela se entende de outro cômodo, sem olhar. */
const SONS = {
  // outra pessoa entrou no canal: duas badaladas subindo
  entrar: (d) => { sino(d, NOTA.E5, 0, .5, .16); sino(d, NOTA.B5, .085, .6, .18); },

  // outra pessoa saiu: as mesmas duas, descendo
  sair: (d) => { sino(d, NOTA.B5, 0, .45, .15); sino(d, NOTA.E5, .085, .55, .16); },

  // VOCÊ entrou no canal de voz: três notas subindo, um pouco mais longo
  conectou: (d) => { sino(d, NOTA.A4, 0, .4, .13); sino(d, NOTA.E5, .08, .45, .15); sino(d, NOTA.A5, .16, .7, .17); },

  // VOCÊ saiu do canal de voz
  desconectou: (d) => { sino(d, NOTA.A5, 0, .38, .15); sino(d, NOTA.E5, .08, .42, .14); sino(d, NOTA.A4, .16, .6, .13); },

  // mensagem nova: uma badalada com nota de apoio, discreta
  mensagem: (d) => { sino(d, NOTA.G5, 0, .22, .08, 2); sino(d, NOTA.C6, .05, .38, .13, 2.5); },

  // te mencionaram: mais agudo e insistente que mensagem comum
  mencao: (d) => { sino(d, NOTA.E6, 0, .3, .16, 4); sino(d, NOTA.E6, .13, .45, .14, 4); },

  /* Cliques de microfone e escuta. Estes tocam MUITO, então são curtos,
   * baixos e pouco metálicos (brilho baixo = madeira, não sino) — senão
   * cansam em dez minutos. Subindo abre, descendo fecha. */
  mudo:     (d) => { sino(d, NOTA.A5, 0, .1, .1, 1.2); sino(d, NOTA.E5, .055, .14, .1, 1.2); },
  desmudo:  (d) => { sino(d, NOTA.E5, 0, .1, .1, 1.2); sino(d, NOTA.A5, .055, .16, .11, 1.2); },

  // escuta: uma oitava abaixo do microfone, para não confundir os dois
  surdo:    (d) => { sino(d, NOTA.E4, 0, .12, .11, 1); sino(d, NOTA.A3, .06, .18, .11, 1); },
  desurdo:  (d) => { sino(d, NOTA.A3, 0, .12, .11, 1); sino(d, NOTA.E4, .06, .2, .12, 1); },

  // chamada entrante: dois toques repetidos, mais insistente que mensagem
  chamada: (d) => {
    sino(d, NOTA.A5, 0, .3, .2, 2.5); sino(d, NOTA.E5, .12, .3, .18, 2.5);
    sino(d, NOTA.A5, .5, .3, .2, 2.5); sino(d, NOTA.E5, .62, .3, .18, 2.5);
  },

  // zumbido: nada de sino — grave, trêmulo e incômodo, como manda o nome
  zumbido: (d) => {
    tom(d, { freq: 120, para: 88, quando: 0, dur: .18, vol: .16, tipo: 'sawtooth' });
    tom(d, { freq: 130, para: 92, quando: .16, dur: .18, vol: .16, tipo: 'sawtooth' });
    tom(d, { freq: 118, para: 80, quando: .32, dur: .24, vol: .14, tipo: 'sawtooth' });
  }
};

/* A soundboard: estes SAEM no seu áudio, todo mundo no canal ouve. */
const BOARD = [
  { id: 'toque',    label: 'toque',    toca: (d) => { sino(d, NOTA.B5, 0, .35, .3, 3); sino(d, NOTA.E6, .07, .5, .3, 3); } },
  { id: 'sino',     label: 'sino',     toca: (d) => sino(d, NOTA.C6, 0, .9, .32, 6) },
  { id: 'fanfarra', label: 'fanfarra', toca: (d) => [NOTA.C5, NOTA.E5, NOTA.G5, NOTA.C6].forEach((n, i) => sino(d, n, i * .09, .55, .26, 2.5)) },
  { id: 'moeda',    label: 'moeda',    toca: (d) => { sino(d, NOTA.B5, 0, .12, .26, 1.5); sino(d, NOTA.E6, .06, .3, .28, 1.5); } },
  { id: 'buzina',   label: 'buzina',   toca: (d) => { tom(d, { freq: 330, quando: 0, dur: .16, vol: .26, tipo: 'square' }); tom(d, { freq: 247, quando: .15, dur: .3, vol: .26, tipo: 'square' }); } },
  { id: 'tambor',   label: 'tambor',   toca: (d) => tom(d, { freq: 170, para: 55, quando: 0, dur: .3, vol: .4, tipo: 'triangle' }) },
  { id: 'erro',     label: 'erro',     toca: (d) => { tom(d, { freq: 220, para: 190, quando: 0, dur: .16, vol: .24, tipo: 'sawtooth' }); tom(d, { freq: 165, para: 130, quando: .16, dur: .34, vol: .24, tipo: 'sawtooth' }); } },
  { id: 'laser',    label: 'laser',    toca: (d) => tom(d, { freq: 1600, para: 200, quando: 0, dur: .28, vol: .22, tipo: 'sawtooth' }) }
];

/** Aviso da sala: toca só para você. */
/* 'surdo' e 'desurdo' são os avisos que ANUNCIAM a própria transição de
 * ficar/deixar de ser surdo — por isso pulam a guarda de state.deaf. Sem
 * essa exceção, os dois se calariam: um porque já é surdo, o outro porque
 * ainda é surdo no instante em que é chamado. */
const IGNORA_SURDO = new Set(['surdo', 'desurdo']);

function playSound(nome) {
  if (!state.sounds) return;
  if (state.deaf && !IGNORA_SURDO.has(nome)) return;
  const destino = saidaDeSons();
  if (destino && SONS[nome]) SONS[nome](destino);
}

/** Som da soundboard: você ouve E vai misturado no que sai para os pares. */
function playBoard(item) {
  const destino = saidaDeSons();
  if (!destino) return;
  item.toca(destino);
  if (state.mixDest) item.toca(state.mixDest);   // os pares também
}

/* Botões nos ajustes para ouvir cada aviso avulso. Sem isso, para escutar
 * o som de "alguém saiu" você precisava de outra pessoa saindo. */
function buildSoundTest() {
  el.soundTest.textContent = '';
  const nomes = {
    conectou: 'você entrou', desconectou: 'você saiu',
    entrar: 'alguém entrou', sair: 'alguém saiu',
    mensagem: 'mensagem', mencao: 'te chamaram', zumbido: 'zumbido',
    mudo: 'mutou', desmudo: 'desmutou', surdo: 'ensurdeceu', desurdo: 'voltou a ouvir'
  };
  Object.entries(nomes).forEach(([id, rotulo]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = rotulo;
    // Toca mesmo com "sons da sala" desligado: aqui é para escutar de fato.
    b.addEventListener('click', () => {
      const destino = saidaDeSons();
      if (destino) SONS[id]?.(destino);
    });
    el.soundTest.appendChild(b);
  });
}

function buildSoundboard() {
  el.soundGrid.textContent = '';
  BOARD.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'sound-btn';
    b.type = 'button';
    b.textContent = s.label;
    b.addEventListener('click', () => {
      playBoard(s);
      state.socket?.emit('soundboard', { label: s.label });
    });
    el.soundGrid.appendChild(b);
  });
}

[el.soundBtn, el.toolSound].forEach((botao) => botao.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!el.soundPop.hidden) return (el.soundPop.hidden = true);
  el.soundPop.hidden = false;
  if (isNarrow()) { el.soundPop.style.left = ''; el.soundPop.style.top = ''; return; }

  // Ancora no botão que foi clicado — o do topo ou o da barra de ferramentas.
  const r = botao.getBoundingClientRect();
  const pop = el.soundPop.getBoundingClientRect();
  el.soundPop.style.left = `${Math.max(8, Math.min(r.right - pop.width, innerWidth - pop.width - 8))}px`;
  el.soundPop.style.top = r.bottom + pop.height + 12 < innerHeight
    ? `${r.bottom + 8}px`
    : `${Math.max(8, r.top - pop.height - 8)}px`;
}));

/* ------------------------------ zumbido ------------------------------ */

[el.nudgeBtn, el.toolNudge].forEach((b) =>
  b.addEventListener('click', () => state.socket?.emit('nudge')));

let shakeTimer = null;
function shakeScreen() {
  el.app.dataset.shake = 'true';
  clearTimeout(shakeTimer);
  shakeTimer = setTimeout(() => { el.app.dataset.shake = 'false'; }, 600);
}

/* ------------------------------ microfone ------------------------------ */

[el.micBtn, el.stageMicBtn].forEach((b) => b.addEventListener('click', () => toggleMic()));

/* `comSom` existe porque o push-to-talk chama isto a cada tecla: com o
 * clique ligado, segurar para falar viraria metralhadora de bipes. */
function setMic(on, comSom = false) {
  const track = state.mic?.getAudioTracks()[0];
  if (!track) return;

  const mudou = track.enabled !== on;
  track.enabled = on;

  el.micBtn.dataset.on = String(on);
  el.micBtn.querySelector('use').setAttribute('href', on ? '#i-mic' : '#i-mic-off');
  el.stageMicBtn.dataset.on = String(on);
  el.stageMicBtn.querySelector('use').setAttribute('href', on ? '#i-mic' : '#i-mic-off');
  el.stageMicLabel.textContent = on ? 'Microfone' : 'Mudo';

  state.socket?.emit('state', { muted: !on });
  const me = state.members.get(state.me?.id);
  if (me) { me.muted = !on; paintMember(me.id); }
  meuRosterPatch({ muted: !on });

  // Só soa quando algo mudou de fato, e nunca em push-to-talk.
  if (comSom && mudou) playSound(on ? 'desmudo' : 'mudo');
}

function toggleMic() {
  const track = state.mic?.getAudioTracks()[0];
  if (!track) return;
  if (state.ptt) return toast('Push-to-talk está ligado. Desligue nos ajustes para usar o botão.');
  setMic(!track.enabled, true);
}

el.deafBtn.addEventListener('click', toggleDeaf);

function toggleDeaf() {
  state.deaf = !state.deaf;
  // 'surdo'/'desurdo' furam a guarda de state.deaf em playSound() de propósito.
  playSound(state.deaf ? 'surdo' : 'desurdo');
  el.deafBtn.dataset.on = String(!state.deaf);
  el.deafBtn.querySelector('use').setAttribute('href', state.deaf ? '#i-headset-off' : '#i-headset');
  applyAllVolumes();

  // Ficar surdo também silencia o próprio microfone, como manda o costume.
  const track = state.mic?.getAudioTracks()[0];
  if (state.deaf && track?.enabled && !state.ptt) setMic(false);

  state.socket?.emit('state', { deaf: state.deaf });
  const me = state.members.get(state.me?.id);
  if (me) { me.deaf = state.deaf; paintMember(me.id); }
  meuRosterPatch({ deaf: state.deaf });
}

/* ------------------------- medidores de voz ------------------------- */

function attachMeter(id, stream) {
  if (!state.audioCtx || !stream?.getAudioTracks?.().length) return;
  const source = state.audioCtx.createMediaStreamSource(stream);
  const analyser = state.audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);
  state.meters.set(id, { analyser, buf: new Uint8Array(analyser.frequencyBinCount) });
}

function levelOf({ analyser, buf }) {
  analyser.getByteFrequencyData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.min(1, (Math.sqrt(sum / buf.length) / 255) * 3.2);
}

function tickMeters() {
  const avataresDoRoster = state.voiceChannel ? state.rosterMemberEls.get(state.voiceChannel.id) : null;

  state.meters.forEach((meter, id) => {
    const n = state.nodes.get(id);
    const m = state.members.get(id);
    if (!n || !m) return;

    const talking = !m.muted && levelOf(meter) > 0.14;
    if (talking && m.mine) state.lastActivity = Date.now(); // falar conta como estar aqui

    // A borda de "falando" fica só na listagem do canal de voz agora — a
    // coluna da direita é a lista do servidor inteiro, sem esse indicador.
    avataresDoRoster?.get(id)?.classList.toggle('is-speaking', talking);
    n.tile.dataset.speaking = String(talking);
  });

  if (!el.settings.hidden) el.testBar.style.width = `${Math.round(rawLevel() * 100)}%`;
  requestAnimationFrame(tickMeters);
}

/* O medidor normal zera quando a faixa está muda, e é isso que se quer no
 * anel de quem fala. O teste precisa do sinal cru — daí um clone da faixa,
 * com o próprio `enabled`, que nunca é enviado a ninguém. */
let testMeter = null;

function buildTestMeter() {
  releaseTestMeter();
  const track = state.mic?.getAudioTracks()[0];
  if (!track || !state.audioCtx) return;

  const clone = track.clone();
  clone.enabled = true;
  const source = state.audioCtx.createMediaStreamSource(new MediaStream([clone]));
  const analyser = state.audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;

  let ultimoNo = source;
  let testRnnoiseNode = null;
  let testNoiseNode = null;

  if (state.noiseSuppression && state.rnnoiseWorkletLoaded) {
    try {
      testRnnoiseNode = new AudioWorkletNode(state.audioCtx, 'rnnoise-denoiser', {
        processorOptions: { wasmBinary: state.rnnoiseWasmBytes }
      });
      ultimoNo.connect(testRnnoiseNode);
      ultimoNo = testRnnoiseNode;
    } catch (_) { testRnnoiseNode = null; }
  }

  if (state.noiseSuppression && state.noiseWorkletLoaded) {
    try {
      testNoiseNode = new AudioWorkletNode(state.audioCtx, 'noise-gate-processor');
      testNoiseNode.port.postMessage({ threshold: getNoiseThreshold() });
      ultimoNo.connect(testNoiseNode);
      ultimoNo = testNoiseNode;
    } catch (_) { testNoiseNode = null; }
  }

  ultimoNo.connect(analyser);
  testMeter = { clone, analyser, testRnnoiseNode, testNoiseNode, buf: new Uint8Array(analyser.frequencyBinCount) };
}

function releaseTestMeter() {
  testMeter?.clone.stop();
  testMeter = null;
}

function rawLevel() { return testMeter ? levelOf(testMeter) : 0; }

/* ------------------------------ conversa ------------------------------ */

el.sendBtn.addEventListener('click', sendText);
el.msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendText();
  if (e.key === 'Escape') { cancelEdit(); cancelReply(); }
});

el.msgInput.addEventListener('input', () => {
  const now = Date.now();
  if (!el.msgInput.value || now - state.typingSentAt < 1800) return;
  state.typingSentAt = now;
  state.socket.emit('typing', { channelId: state.textChannel });
});

function sendText() {
  const text = el.msgInput.value.trim();
  if (!text) return;

  if (state.editing) {
    state.socket.emit('chat-edit', { id: state.editing, text });
    cancelEdit();
    return;
  }

  state.socket.emit('chat', { channelId: state.textChannel, text, replyTo: state.replyTo?.id || null });
  el.msgInput.value = '';
  state.typingSentAt = 0;
  cancelReply();
}

/* ---- marcação de texto ---- */

function applyEmoticons(text) {
  let out = text;
  for (const [from, to] of EMOTICONS) out = out.split(from).join(to);
  return out;
}

// Constrói nós de DOM, nunca innerHTML: o texto vem de outra pessoa.
function renderInline(text, into) {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|`[^`]+`|\|\|[^|]+\|\||https?:\/\/[^\s]+|@[^\s@]{1,24})/g;
  let last = 0, match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) into.appendChild(document.createTextNode(text.slice(last, match.index)));
    const tok = match[0];

    if (tok.startsWith('**') || tok.startsWith('__')) {
      const b = document.createElement('strong');
      b.textContent = tok.slice(2, -2);
      into.appendChild(b);
    } else if (tok.startsWith('~~')) {
      const s = document.createElement('s');
      s.textContent = tok.slice(2, -2);
      into.appendChild(s);
    } else if (tok.startsWith('*')) {
      const i = document.createElement('em');
      i.textContent = tok.slice(1, -1);
      into.appendChild(i);
    } else if (tok.startsWith('`')) {
      const c = document.createElement('code');
      c.textContent = tok.slice(1, -1);
      into.appendChild(c);
    } else if (tok.startsWith('||')) {
      const sp = document.createElement('span');
      sp.className = 'spoiler';
      sp.textContent = tok.slice(2, -2);
      sp.addEventListener('click', () => sp.classList.add('is-open'));
      into.appendChild(sp);
    } else if (tok.startsWith('http')) {
      const a = document.createElement('a');
      a.href = tok;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = tok;
      into.appendChild(a);
    } else {
      into.appendChild(mentionNode(tok));
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)));
}

function mentionNode(tok) {
  const who = tok.slice(1).toLowerCase();
  const everyone = who === 'todos' || who === 'everyone' || who === 'geral';
  const hit = everyone || [...state.members.values()].some((m) => m.name.toLowerCase() === who);
  if (!hit) return document.createTextNode(tok);

  const mine = everyone
    || state.user?.name?.toLowerCase() === who;
  const span = document.createElement('span');
  span.className = mine ? 'mention is-me' : 'mention';
  span.textContent = tok;
  return span;
}

function mentionsMe(text) {
  const mine = state.user?.name?.toLowerCase();
  if (!mine) return false;
  const re = /@([^\s@]{1,24})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const who = m[1].toLowerCase();
    if (who === mine || who === 'todos' || who === 'everyone' || who === 'geral') return true;
  }
  return false;
}

function renderBody(text, into) {
  // Blocos de código saem antes, para não sofrerem as outras regras.
  const parts = text.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = part.replace(/^\n/, '');
      pre.appendChild(code);
      into.appendChild(pre);
    } else if (part) {
      renderInline(applyEmoticons(part), into);
    }
  });
}

function isOnlyEmoji(text) {
  return text.length <= 8 && /^\p{Extended_Pictographic}+$/u.test(text.replace(/️/g, ''));
}

/* ---- desenhar uma mensagem ---- */

function renderMessage(m, old) {
  // A mensagem carrega o id da CONTA; state.me.id é o id do socket na voz.
  const mine = m.uid === state.user?.id;
  const mention = m.kind === 'text' && !mine && mentionsMe(m.text || '');

  const grouped = state.lastMsg
    && state.lastMsg.uid === m.uid
    && !m.replyTo && !mention
    && m.at - state.lastMsg.at < 5 * 60 * 1000;

  const li = document.createElement('li');
  li.className = grouped ? 'msg is-grouped' : 'msg';
  li.dataset.id = m.id;
  if (mention) li.classList.add('is-mention');
  if (old) li.style.opacity = '.72';

  const gutter = document.createElement('div');
  gutter.className = 'msg-gutter';
  if (!grouped) {
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    paintAvatar(avatar, m.name);
    gutter.appendChild(avatar);
  }

  const col = document.createElement('div');
  col.className = 'msg-body-col';

  if (m.replyTo) {
    const r = document.createElement('div');
    r.className = 'msg-reply';
    r.appendChild(icon('i-reply'));
    const b = document.createElement('b');
    b.textContent = m.replyTo.name;
    const s = document.createElement('span');
    s.textContent = m.replyTo.text;
    r.append(b, s);
    col.appendChild(r);
  }

  if (!grouped) {
    const head = document.createElement('div');
    head.className = 'msg-head';
    const who = document.createElement('span');
    who.className = 'msg-who';
    who.textContent = mine ? `${m.name} (você)` : m.name;
    who.style.color = colorFor(m.name);
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    head.append(who, time);
    col.appendChild(head);
  }

  const body = document.createElement('div');
  body.className = 'msg-text';

  if (m.kind === 'image') {
    const img = document.createElement('img');
    img.className = 'msg-image';
    img.src = m.data;
    img.alt = m.fileName || 'imagem';
    img.addEventListener('click', () => window.open(m.data, '_blank', 'noopener'));
    body.appendChild(img);
  } else if (m.kind === 'audio') {
    const label = document.createElement('div');
    label.className = 'msg-audio-label';
    label.textContent = `mensagem de voz · ${formatSeconds(m.seconds)}`;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = m.data;
    body.append(label, audio);
  } else {
    if (isOnlyEmoji(m.text)) body.classList.add('is-emoji');
    renderBody(m.text, body);
    if (m.editedAt) {
      const e = document.createElement('span');
      e.className = 'msg-edited';
      e.textContent = ' (editado)';
      body.appendChild(e);
    }
  }
  col.appendChild(body);

  const reactions = document.createElement('div');
  reactions.className = 'msg-reactions';
  col.appendChild(reactions);

  li.append(gutter, col, buildActions(m, mine));
  appendToLog(li);

  state.messages.set(m.id, { msg: m, node: li, body, reactions });
  paintReactions(m.id);
  state.lastMsg = { uid: m.uid, at: m.at };

  state.typers.delete(m.uid);
  paintTyping();

  // A própria mensagem nunca conta como não lida — nem quando a aba está
  // escondida, que é o caso de quem escreve por atalho e volta para o jogo.
  if (!old && !mine) {
    // Ser chamado soa diferente de mensagem qualquer — dá para saber sem olhar.
    playSound(mention ? 'mencao' : 'mensagem');
    if (state.view !== 'chat' || document.hidden) bumpUnread(mention, m);
  }
}

function buildActions(m, mine) {
  const bar = document.createElement('div');
  bar.className = 'msg-actions';

  const act = (ico, title, fn) => {
    const b = document.createElement('button');
    b.className = 'msg-action';
    b.type = 'button';
    b.title = title;
    b.appendChild(icon(ico));
    b.addEventListener('click', fn);
    bar.appendChild(b);
  };

  act('i-smile', 'Reagir', (e) => openReactPicker(m.id, e.currentTarget));
  act('i-reply', 'Responder', () => startReply(m));
  if (mine && m.kind === 'text') act('i-pencil', 'Editar', () => startEdit(m));
  if (mine) act('i-trash', 'Apagar', () => state.socket.emit('chat-delete', { id: m.id }));

  return bar;
}

function appendToLog(node) {
  const atBottom = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 60;
  el.log.appendChild(node);
  if (atBottom) el.log.scrollTop = el.log.scrollHeight;
}

function system(text, kind) {
  const li = document.createElement('li');
  li.className = kind === 'out' ? 'msg msg-system is-out' : 'msg msg-system';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.textContent = kind === 'out' ? '←  ' : '→  ';
  li.append(dot, document.createTextNode(text));
  appendToLog(li);
  state.lastMsg = null;
}

/* ---- editar, apagar, reagir, responder ---- */

function applyEdit({ id, text, editedAt }) {
  const entry = state.messages.get(id);
  if (!entry) return;
  entry.msg.text = text;
  entry.msg.editedAt = editedAt;
  entry.body.textContent = '';
  if (isOnlyEmoji(text)) entry.body.classList.add('is-emoji');
  renderBody(text, entry.body);
  const e = document.createElement('span');
  e.className = 'msg-edited';
  e.textContent = ' (editado)';
  entry.body.appendChild(e);
}

function applyDelete({ id }) {
  const entry = state.messages.get(id);
  if (!entry) return;
  entry.node.remove();
  state.messages.delete(id);
  if (state.editing === id) cancelEdit();
  if (state.replyTo?.id === id) cancelReply();
}

function applyReaction({ id, emoji, who }) {
  const entry = state.messages.get(id);
  if (!entry) return;
  if (who.length) entry.msg.reactions[emoji] = who;
  else delete entry.msg.reactions[emoji];
  paintReactions(id);
}

/** Nomes de quem reagiu, pra mostrar em cima do chip — "você" primeiro. */
function nomesDeQuem(ids) {
  return ids.map((uid) => uid === state.user?.id ? 'você' : (state.guildMembers.get(uid)?.name || 'alguém'));
}

function paintReactions(id) {
  const entry = state.messages.get(id);
  if (!entry) return;

  entry.reactions.textContent = '';
  Object.entries(entry.msg.reactions || {}).forEach(([emoji, who]) => {
    const chip = document.createElement('button');
    chip.className = 'reaction-chip';
    chip.type = 'button';
    chip.dataset.mine = String(who.includes(state.user?.id));
    chip.textContent = `${emoji} ${who.length}`;
    chip.title = nomesDeQuem(who).join(', ');
    chip.addEventListener('click', () => state.socket.emit('chat-react', { id, emoji }));
    entry.reactions.appendChild(chip);
  });
}

function openReactPicker(id, anchor) {
  buildEmojiPop();
  el.emojiPop.dataset.target = id;
  el.emojiPop.hidden = false;
  el.emojiPop.style.position = 'fixed';
  const r = anchor.getBoundingClientRect();
  const pop = el.emojiPop.getBoundingClientRect();
  el.emojiPop.style.left = `${Math.max(8, Math.min(r.left - pop.width, innerWidth - pop.width - 8))}px`;
  el.emojiPop.style.top = `${Math.max(8, r.bottom + 6)}px`;
  el.emojiPop.style.right = 'auto';
  el.emojiPop.style.bottom = 'auto';
}

function startReply(m) {
  cancelEdit();
  state.replyTo = m;
  el.replyText.textContent = `respondendo ${m.name}: ${String(m.text || 'mídia').slice(0, 60)}`;
  el.replyBar.hidden = false;
  setView('chat');
  el.msgInput.focus();
}

function cancelReply() {
  state.replyTo = null;
  el.replyBar.hidden = true;
}

function startEdit(m) {
  cancelReply();
  state.editing = m.id;
  el.msgInput.value = m.text;
  el.editHint.hidden = false;
  setView('chat');
  el.msgInput.focus();
}

function cancelEdit() {
  if (!state.editing) return;
  state.editing = null;
  el.msgInput.value = '';
  el.editHint.hidden = true;
}

el.replyCancel.addEventListener('click', cancelReply);

function paintTyping() {
  const now = Date.now();
  [...state.typers.entries()].forEach(([id, t]) => { if (t.until < now) state.typers.delete(id); });

  const names = [...state.typers.values()].map((t) => t.name);
  if (!names.length) return (el.typing.textContent = '');
  el.typing.textContent = names.length === 1
    ? `${names[0]} está digitando…`
    : `${names.slice(0, 2).join(' e ')}${names.length > 2 ? ' e mais gente' : ''} estão digitando…`;
}
setInterval(paintTyping, 1200);

/* --------------------- não lidas, título e avisos --------------------- */

function setTitle(prefix) {
  document.title = `${prefix || ''}${state.guild?.name || 'Concord'} · Concord`;
}

function bumpUnread(mention, m) {
  state.unread++;
  if (mention) state.mentions++;
  setTitle(`(${state.unread}) `);

  // A pílula fica no canal onde a mensagem caiu, não numa só fixa.
  const pilula = itemDoCanal(m.channelId || state.textChannel)?.querySelector('.unread-pill');
  if (pilula) {
    pilula.textContent = String(state.unread);
    setShown(pilula, true);
  }

  if (mention && document.hidden && state.notify && Notification.permission === 'granted') {
    const n = new Notification(`${m.name} chamou você`, {
      body: String(m.text || '').slice(0, 120),
      tag: 'concord-mention'
    });
    n.onclick = () => { window.focus(); n.close(); };
  }
}

function clearUnread() {
  state.unread = 0;
  state.mentions = 0;
  el.channels?.querySelectorAll('.unread-pill').forEach((p) => setShown(p, false));
  setTitle();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.view === 'chat') clearUnread();
});

/* ------------------------------ imagens ------------------------------ */

el.imageBtn.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  if (el.fileInput.files[0]) sendImage(el.fileInput.files[0]);
  el.fileInput.value = '';
});

document.addEventListener('paste', (e) => {
  if (!state.joined) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  sendImage(item.getAsFile());
});

let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  if (!state.joined || !e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  el.dropZone.hidden = false;
});
document.addEventListener('dragover', (e) => { if (state.joined) e.preventDefault(); });
document.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; el.dropZone.hidden = true; }
});
document.addEventListener('drop', (e) => {
  if (!state.joined) return;
  e.preventDefault();
  dragDepth = 0;
  el.dropZone.hidden = true;
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) sendImage(file);
});

// Print de tela costuma vir enorme. Reduzir antes de mandar é a diferença
// entre chegar na hora e travar a sala.
async function sendImage(file) {
  if (!file || !file.type.startsWith('image/')) return;

  let data;
  try {
    data = await shrinkImage(file);
  } catch (_) {
    return toast('Não deu para ler essa imagem.');
  }
  if (data.length > 3e6) return toast('Imagem grande demais mesmo depois de reduzir.');

  state.socket.emit('image', { channelId: state.textChannel, data, mime: file.type, name: file.name });
  setView('chat');
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale === 1 && String(reader.result).length < 1.2e6) return resolve(String(reader.result));

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        // PNG com transparência continua PNG; o resto vira JPEG, bem menor.
        const out = file.type === 'image/png' && scale === 1
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', 0.85);
        resolve(out);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/* ------------------------------ reações ------------------------------ */

let emojiBuilt = false;
function buildEmojiPop() {
  if (emojiBuilt) return;
  emojiBuilt = true;
  EMOJIS.forEach((emoji) => {
    const b = document.createElement('button');
    b.className = 'emoji-btn';
    b.type = 'button';
    b.textContent = emoji;
    b.addEventListener('click', () => {
      const target = el.emojiPop.dataset.target;
      if (target) state.socket.emit('chat-react', { id: target, emoji });
      else state.socket.emit('reaction', { emoji });
      el.emojiPop.hidden = true;
      delete el.emojiPop.dataset.target;
    });
    el.emojiPop.appendChild(b);
  });
}

el.emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  buildEmojiPop();
  delete el.emojiPop.dataset.target;   // sem alvo = reação flutuante
  el.emojiPop.style.position = '';
  el.emojiPop.style.left = ''; el.emojiPop.style.top = '';
  el.emojiPop.style.right = ''; el.emojiPop.style.bottom = '';
  el.emojiPop.hidden = !el.emojiPop.hidden;
});

function floatEmoji(emoji, who) {
  const div = document.createElement('div');
  div.className = 'float';
  div.textContent = emoji;
  const tag = document.createElement('small');
  tag.textContent = who;
  div.appendChild(tag);
  div.style.left = `${10 + Math.random() * 74}%`;
  el.floats.appendChild(div);
  setTimeout(() => div.remove(), 2600);
}

// Um só ouvinte fecha todos os painéis flutuantes.
document.addEventListener('click', (e) => {
  const inside = (pop, ...extra) =>
    pop.contains(e.target) || extra.some((sel) => e.target.closest?.(sel));

  if (!el.emojiPop.hidden && !inside(el.emojiPop, '#emojiBtn', '.msg-action')) el.emojiPop.hidden = true;
  if (!el.volumePop.hidden && !inside(el.volumePop, '.member', '.tile-volume')) el.volumePop.hidden = true;
  if (!el.statusPop.hidden && !inside(el.statusPop, '#meCard')) el.statusPop.hidden = true;
  if (!el.soundPop.hidden && !inside(el.soundPop, '#soundBtn', '#toolSound')) el.soundPop.hidden = true;
  if (!el.profilePop.hidden && !inside(el.profilePop, '.member', '.vmember')) el.profilePop.hidden = true;
});

/* --------------------------- áudio gravado --------------------------- */

let rec = null;

el.recBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); startRec(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
  el.recBtn.addEventListener(ev, () => stopRec());
});
el.recBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rec ? stopRec() : startRec(); }
});

async function startRec() {
  if (rec) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
  } catch (_) {
    return toast('Sem acesso ao microfone para gravar.');
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
    if (blob.size > 4e6) return toast('Áudio muito longo — grave até uns 45 segundos.');

    const reader = new FileReader();
    reader.onload = () => state.socket.emit('voice-note', { channelId: state.textChannel, data: reader.result, seconds, mime: blob.type });
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

/* --------------------------- atalhos de teclado --------------------------- */

document.addEventListener('keydown', (e) => {
  if (!state.joined) return;

  if (e.key === 'Escape') {
    if (!el.settings.hidden) return closeSettings();
    if (!el.volumePop.hidden) return (el.volumePop.hidden = true);
    if (!el.statusPop.hidden) return (el.statusPop.hidden = true);
    if (!el.soundPop.hidden) return (el.soundPop.hidden = true);
    if (!el.emojiPop.hidden) return (el.emojiPop.hidden = true);
    if (!el.profilePop.hidden) return (el.profilePop.hidden = true);
    if (state.editing) return cancelEdit();
    if (state.replyTo) return cancelReply();
    if (state.drawer !== 'none') return closeDrawers();
    if (state.focused) return setFocus(null);
  }

  const key = e.key.toLowerCase();
  // `!e.repeat` não é espera: é um zumbido por aperto. Sem isso, segurar a
  // tecla dispararia a repetição automática do teclado, dezenas por segundo.
  if (e.ctrlKey && e.shiftKey && key === 'z') {
    e.preventDefault();
    if (!e.repeat) state.socket?.emit('nudge');
    return;
  }
  if (e.ctrlKey && e.shiftKey && key === 'd') { e.preventDefault(); return toggleDeaf(); }
  if (e.ctrlKey && !e.shiftKey && key === 'm') { e.preventDefault(); return toggleMic(); }

  if (state.ptt && e.code === 'Space' && !typingSomewhere() && !e.repeat && !state.pttHeld) {
    e.preventDefault();
    state.pttHeld = true;
    setMic(true);
  }
});

document.addEventListener('keyup', (e) => {
  if (state.ptt && e.code === 'Space' && state.pttHeld) {
    state.pttHeld = false;
    setMic(false);
  }
});

// Trocar de janela segurando a tecla deixaria o microfone aberto para sempre.
window.addEventListener('blur', () => {
  if (state.ptt && state.pttHeld) { state.pttHeld = false; setMic(false); }
});

/* --------------------------- ajustes e aparelhos --------------------------- */

function loadPrefs() {
  state.ptt = store.get('ptt') === '1';
  state.sounds = store.get('sons', '1') === '1';
  state.notify = store.get('avisos') === '1';
  state.autoAway = store.get('ausente', '1') === '1';
  state.noiseSuppression = store.get('noise', '1') === '1';
  state.noiseThreshold = Number(store.get('noise_threshold', '20')) || 20;
  state.quality = store.get('qualidade', '1080');
  state.note = store.get('recado', '');
  state.status = store.get('status', 'online');

  el.pttCheck.checked = state.ptt;
  el.noiseCheck.checked = state.noiseSuppression;
  setNoiseThreshold(state.noiseThreshold);
  updateNoiseSensitivityUI();
  el.soundsCheck.checked = state.sounds;
  el.notifyCheck.checked = state.notify;
  el.awayCheck.checked = state.autoAway;
  el.qualitySelect.value = state.quality;
  el.noteInput.value = state.note;

  const me = state.members.get(state.me?.id);
  if (me) { me.status = state.status; me.note = state.note; paintMember(me.id); }
  paintStatusList();
  if (state.ptt) setMic(false);
}

el.pttCheck.addEventListener('change', () => {
  state.ptt = el.pttCheck.checked;
  store.set('ptt', state.ptt ? '1' : '0');
  setMic(!state.ptt);   // ligou: entra mudo, só abre com a tecla
});

el.noiseCheck.addEventListener('change', () => {
  state.noiseSuppression = el.noiseCheck.checked;
  store.set('noise', state.noiseSuppression ? '1' : '0');
  updateNoiseSensitivityUI();
  connectMicToMix();
  if (!el.settings.hidden) buildTestMeter();
});

el.noiseThresholdRange?.addEventListener('input', (e) => {
  setNoiseThreshold(e.target.value);
});

el.testVoiceBtn?.addEventListener('click', toggleTestVoice);

el.soundsCheck.addEventListener('change', () => {
  state.sounds = el.soundsCheck.checked;
  store.set('sons', state.sounds ? '1' : '0');
});

el.awayCheck.addEventListener('change', () => {
  state.autoAway = el.awayCheck.checked;
  store.set('ausente', state.autoAway ? '1' : '0');
});

el.notifyCheck.addEventListener('change', async () => {
  if (!el.notifyCheck.checked) {
    state.notify = false;
    store.set('avisos', '0');
    return;
  }
  if (!('Notification' in window)) {
    el.notifyCheck.checked = false;
    return toast('Este navegador não tem notificações.');
  }
  const perm = await Notification.requestPermission();
  state.notify = perm === 'granted';
  el.notifyCheck.checked = state.notify;
  store.set('avisos', state.notify ? '1' : '0');
  if (!state.notify) toast('Você negou as notificações no navegador.');
});

el.settingsBtn.addEventListener('click', () => {
  el.settings.hidden = false;
  loadDevices();
  buildTestMeter();

  const eu = state.guildMembers.get(state.user?.id);
  el.nicknameInput.value = (eu && eu.name !== eu.realName) ? eu.name : '';
  el.nicknameMsg.textContent = '';
});
el.settingsClose.addEventListener('click', closeSettings);
el.settings.addEventListener('click', (e) => { if (e.target === el.settings) closeSettings(); });

function closeSettings() {
  el.settings.hidden = true;
  stopTestVoice();
  releaseTestMeter();   // o clone da faixa não fica ligado à toa
  el.testBar.style.width = '0%';
}

// Barra lateral de categorias dos ajustes — as seções já existem prontas no
// HTML, só troca qual fica visível (nada de re-renderizar como no admin).
el.settingsNav.addEventListener('click', (e) => {
  const btn = e.target.closest('.admin-tab');
  if (!btn) return;
  el.settingsNav.querySelectorAll('.admin-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
  el.settingsPane.querySelectorAll('section').forEach((s) => setShown(s, s.dataset.pane === btn.dataset.pane));
});

el.nicknameSaveBtn.addEventListener('click', async () => {
  if (!state.guild) return;
  const apelido = el.nicknameInput.value.trim();
  el.nicknameMsg.textContent = 'Salvando…';
  try {
    await api(`/guilds/${state.guild.id}/members/me/nickname`, {
      method: 'PATCH', body: JSON.stringify({ nickname: apelido || null })
    });
    const eu = state.guildMembers.get(state.user.id);
    if (eu) eu.name = apelido || eu.realName;
    const novoNome = eu?.name || apelido || state.user.name;
    if (state.me) state.me.name = novoNome;
    renderMemberList();
    if (state.voiceChannel) meuRosterPatch({ name: novoNome });
    el.nicknameMsg.textContent = apelido ? 'Apelido salvo.' : 'Apelido removido — voltou ao seu nome.';
  } catch (err) {
    el.nicknameMsg.textContent = err.message || 'Não deu para salvar.';
  }
});

async function loadDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;

  let devices;
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (_) { return; }

  const current = state.mic?.getAudioTracks()[0]?.getSettings()?.deviceId || '';
  el.micSelect.textContent = '';
  devices.filter((d) => d.kind === 'audioinput').forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microfone ${i + 1}`;
    if (d.deviceId === current) opt.selected = true;
    el.micSelect.appendChild(opt);
  });

  // Escolher a saída de som só existe em navegadores Chromium.
  const canPickOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  const outs = devices.filter((d) => d.kind === 'audiooutput');

  if (canPickOutput && outs.length) {
    el.outputRow.hidden = false;
    el.outSelect.textContent = '';
    outs.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Saída ${i + 1}`;
      if (d.deviceId === state.sinkId) opt.selected = true;
      el.outSelect.appendChild(opt);
    });
  } else {
    el.outputRow.hidden = true;
  }
}

navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (state.joined) loadDevices(); });

el.micSelect.addEventListener('change', () => switchMic(el.micSelect.value));

/* Como o que sai é a mistura, trocar de microfone é só religar a entrada
 * dela: a faixa que os pares recebem nem sabe que mudou alguma coisa. */
async function switchMic(deviceId) {
  const wasOn = state.mic?.getAudioTracks()[0]?.enabled !== false;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: { exact: deviceId } }
    });
  } catch (_) {
    return toast('Não deu para usar esse microfone.');
  }

  state.micId = deviceId;
  stream.getAudioTracks()[0].enabled = wasOn;

  state.mic.getTracks().forEach((t) => t.stop());
  state.mic = stream;
  connectMicToMix();

  state.meters.delete(state.me.id);
  attachMeter(state.me.id, stream);
  if (!el.settings.hidden) {
    buildTestMeter();
    if (testVoiceActive) updateTestVoiceRoute();
  }

  toast('Microfone trocado.', 'ok');
}

el.outSelect.addEventListener('change', async () => {
  state.sinkId = el.outSelect.value;
  try {
    await Promise.all([...el.audios.querySelectorAll('audio')].map((a) => a.setSinkId(state.sinkId)));
    toast('Saída de som trocada.', 'ok');
  } catch (_) {
    toast('Este navegador não deixou trocar a saída de som.');
  }
});

/* --------------------------- navegação e saída --------------------------- */

// Os botões de canal são criados em desenharCanais(), com o listener já preso.

function setView(view) {
  state.view = view;
  const isStage = view === 'stage';

  el.stageView.hidden = !isStage;
  el.chatView.hidden = isStage;

  const nomeVoz = state.voiceChannel?.name || 'Voz';
  const nomeTexto = state.channels.find((c) => c.id === state.textChannel)?.name || 'geral';
  el.topbarIco.querySelector('use').setAttribute('href', isStage ? '#i-speaker' : '#i-hash');
  el.viewTitle.textContent = isStage ? nomeVoz : nomeTexto;

  marcarAtivos();
  refreshCount();

  if (!isStage) {
    clearUnread();
    el.log.scrollTop = el.log.scrollHeight;
    if (!isNarrow()) el.msgInput.focus();
  }
}

/* Dois regimes, dois atributos, e nenhum evento de redimensionamento no meio:
 *   data-members → a coluna de pessoas no monitor
 *   data-drawer  → qual gaveta está aberta no celular
 * O CSS escolhe qual obedecer em cada tamanho, então mudar de tamanho nunca
 * deixa gaveta presa aberta. */
function syncPanes() {
  el.app.dataset.members = String(state.membersWanted);
  el.app.dataset.drawer = state.drawer;
}

function closeDrawers() { state.drawer = 'none'; syncPanes(); }

el.membersBtn.addEventListener('click', () => {
  if (isNarrow()) state.drawer = state.drawer === 'members' ? 'none' : 'members';
  else state.membersWanted = !state.membersWanted;
  syncPanes();
});

el.menuBtn.addEventListener('click', () => {
  state.drawer = state.drawer === 'nav' ? 'none' : 'nav';
  syncPanes();
});

el.scrim.addEventListener('click', closeDrawers);

/* O 100dvh não encolhe quando o teclado abre em boa parte dos navegadores
 * de celular, e a caixa de escrever some atrás dele. */
const vv = window.visualViewport;
if (vv) {
  const syncHeight = () => {
    // Só assume o comando quando a diferença é grande o bastante para ser
    // teclado — assim uma medida esquisita do navegador não encolhe a tela.
    if (window.innerHeight - vv.height > 120) {
      document.documentElement.style.setProperty('--vh', `${Math.round(vv.height)}px`);
      if (state.view === 'chat') el.log.scrollTop = el.log.scrollHeight;
    } else {
      document.documentElement.style.removeProperty('--vh');
    }
  };
  vv.addEventListener('resize', syncHeight);
  syncHeight();
}

/* Convite agora é um código gerado pelo servidor, com validade e limite de
 * usos — não mais um nome de sala que qualquer um adivinha. */
[el.copyBtn, el.railCopy].forEach((b) => {
  b.addEventListener('click', async () => {
    if (!state.guild) return;
    try {
      const { invite } = await api(`/guilds/${state.guild.id}/invites`, {
        method: 'POST', body: JSON.stringify({ hours: 24 * 7 })
      });
      const link = `${location.origin}${location.pathname}?convite=${invite.code}`;
      try {
        await navigator.clipboard.writeText(link);
        toast(`Convite ${invite.code} copiado — vale 7 dias.`, 'ok');
      } catch (_) {
        toast(link, 'ok');
      }
    } catch (err) {
      toast(err.message);
    }
  });
});

/* Sair do canal de voz não é sair do servidor: a conversa continua e você
 * segue vendo os canais. Antes isso recarregava a página inteira. */
[el.leaveBtn, el.stageLeaveBtn].forEach((b) => {
  b.addEventListener('click', sairDaVoz);
});

window.addEventListener('beforeunload', () => {
  state.joined = false;
  state.socket?.disconnect();
});

/* --------------------------- tema claro e escuro --------------------------- */

/* O claro é o padrão porque é o que faz o app parecer Messenger. O escuro
 * fica disponível para quem joga de madrugada. */
function aplicarTema(tema) {
  if (tema === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  store.set('tema', tema);
  el.themeCheck.checked = tema === 'dark';
}

aplicarTema(store.get('tema', 'light'));
el.themeCheck.addEventListener('change', () => {
  aplicarTema(el.themeCheck.checked ? 'dark' : 'light');
});

/* --------------------- ponte para a janela de administração --------------------- */

/* admin.js é um arquivo separado para o app.js não crescer sem fim. Só o
 * que ele precisa passa por aqui — nada de vasculhar variável solta. */
window.Concord = {
  state, api, toast, icon, paintAvatar, setShown,
  redesenharCanais: () => { desenharCanais(); marcarAtivos(); }
};

/* ------------------------------ partida ------------------------------ */

iniciar();
