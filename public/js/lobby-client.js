/* ═══════════════════════════════════════════
   UNO x RYZEN — LOBBY CLIENT
   ═══════════════════════════════════════════ */
const AVATARS = ['🐯','🦊','🐼','🐧','🦁','🐸','🦋','🐙',
                 '🦄','🐲','🐺','🦝','🦅','🐬','🦊','🎃',
                 '👾','🤖','💀','🎮','🃏','🌟','🔥','⚡'];
const EMOJIS  = ['😂','❤️','🔥','👍','💀','🎉','🤣','😍','🤔','😎'];

let socket = null;
let myName = '';
let myAvatar = '🐯';
let currentRoom = null;
let isHost = false;
let sessionStats = { played: 0, won: 0, cards: 0 };

// ─── INIT ──────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  runLoadingScreen();
  loadSession();
});

function runLoadingScreen() {
  const texts = [
    'Mengacak kartu...',
    'Memuat animasi...',
    'Menyambungkan server...',
    'Siap bermain!',
  ];
  const bar = document.getElementById('loadingBar');
  const txt = document.getElementById('loadingText');
  let progress = 0;
  let textIdx = 0;

  const interval = setInterval(() => {
    progress += Math.random() * 25 + 5;
    if (progress >= 100) progress = 100;
    bar.style.width = progress + '%';
    txt.textContent = texts[Math.min(textIdx++, texts.length - 1)];
    if (progress >= 100) {
      clearInterval(interval);
      setTimeout(() => {
        document.getElementById('loadingScreen').style.opacity = '0';
        document.getElementById('loadingScreen').style.transition = 'opacity .6s';
        setTimeout(() => {
          document.getElementById('loadingScreen').classList.add('hidden');
          showNameScreenOrLobby();
        }, 600);
      }, 400);
    }
  }, 300);
}

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem('unoRyzenSession') || '{}');
    if (s.name) { myName = s.name; myAvatar = s.avatar || '🐯'; }
    if (s.stats) sessionStats = s.stats;
  } catch {}
}

function saveSession() {
  localStorage.setItem('unoRyzenSession', JSON.stringify({
    name: myName, avatar: myAvatar, stats: sessionStats
  }));
}

function showNameScreenOrLobby() {
  if (myName) {
    initSocket();
    showScreen('lobbyScreen');
    updatePlayerBadge();
    updateStats();
  } else {
    showScreen('nameScreen');
    buildAvatarGrid();
  }
}

function buildAvatarGrid() {
  const grid = document.getElementById('avatarGrid');
  grid.innerHTML = '';
  AVATARS.forEach(a => {
    const div = document.createElement('div');
    div.className = 'ap-item' + (a === myAvatar ? ' selected' : '');
    div.textContent = a;
    div.onclick = () => {
      myAvatar = a;
      grid.querySelectorAll('.ap-item').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
    };
    grid.appendChild(div);
  });
}

function confirmName() {
  const val = document.getElementById('nameInput').value.trim();
  if (!val || val.length < 2) { showToast('Nama minimal 2 karakter!', 'error'); return; }
  myName = val;
  saveSession();
  initSocket();
  showScreen('lobbyScreen');
  updatePlayerBadge();
  updateStats();
}

function showNameScreen() {
  showScreen('nameScreen');
  buildAvatarGrid();
  document.getElementById('nameInput').value = myName;
}

function updatePlayerBadge() {
  document.getElementById('pbAvatar').textContent = myAvatar;
  document.getElementById('pbName').textContent = myName;
}

function updateStats() {
  document.getElementById('statPlayed').textContent = sessionStats.played;
  document.getElementById('statWon').textContent = sessionStats.won;
  document.getElementById('statCards').textContent = sessionStats.cards;
}

// ─── SOCKET ────────────────────────────────────────────────────────────────
function initSocket() {
  if (socket) return;
  socket = io();

  socket.on('connect', () => {
    socket.emit('getGlobalChat');
    refreshPublicRooms();
  });

  socket.on('globalChatHistory', (msgs) => {
    const container = document.getElementById('globalChatMessages');
    container.innerHTML = '';
    msgs.forEach(m => appendGlobalChat(m));
  });

  socket.on('globalChat', (msg) => appendGlobalChat(msg));

  socket.on('publicRooms', (rooms) => renderPublicRooms(rooms));

  socket.on('roomCreated', ({ code }) => {
    currentRoom = code;
    socket.emit('joinRoom', { code, name: myName, avatar: myAvatar });
  });

  socket.on('roomJoined', ({ code }) => {
    currentRoom = code;
    showScreen('roomLobbyScreen');
    document.getElementById('rlCode').textContent = code;
  });

  socket.on('reconnected', ({ code }) => {
    currentRoom = code;
    window.location.href = `/game?room=${code}&name=${encodeURIComponent(myName)}&avatar=${encodeURIComponent(myAvatar)}`;
  });

  socket.on('lobbyState', (state) => {
    renderRoomLobby(state);
  });

  socket.on('gameStarted', () => {
    sessionStats.played++;
    saveSession();
    window.location.href = `/game?room=${currentRoom}&name=${encodeURIComponent(myName)}&avatar=${encodeURIComponent(myAvatar)}`;
  });

  socket.on('roomChat', (msg) => appendRoomChat(msg));

  socket.on('gameLog', ({ msg }) => appendRoomChat({ name: '🎮', avatar: '🎮', msg, isSystem: true }));

  socket.on('joinError', (msg) => showToast(msg, 'error'));

  socket.on('error', (msg) => showToast(msg, 'error'));

  socket.on('kicked', () => {
    showToast('Kamu di-kick dari room!', 'error');
    currentRoom = null;
    showScreen('lobbyScreen');
  });

  // Build emoji bar
  buildEmojiBar();
}

// ─── CHAT ──────────────────────────────────────────────────────────────────
function buildEmojiBar() {
  const bar = document.getElementById('emojiBar');
  bar.innerHTML = '';
  EMOJIS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.textContent = e;
    btn.onclick = () => {
      const input = document.getElementById('globalChatInput');
      input.value = (input.value + e).slice(0, 200);
    };
    bar.appendChild(btn);
  });
}

function appendGlobalChat(msg) {
  const container = document.getElementById('globalChatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (msg.name === myName ? ' cm-mine' : '');
  div.innerHTML = `<div class="cm-avatar">${msg.avatar || '👤'}</div>
    <div class="cm-body">
      <div class="cm-name">${escHtml(msg.name)}</div>
      <div class="cm-text">${escHtml(msg.msg)}</div>
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function sendGlobalChat() {
  const input = document.getElementById('globalChatInput');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('globalChat', { name: myName, avatar: myAvatar, msg });
  input.value = '';
}

function appendRoomChat(msg) {
  const container = document.getElementById('roomChatMessages');
  if (!container) return;
  const div = document.createElement('div');
  const isSystem = msg.isSystem;
  div.className = isSystem ? 'chat-msg system-msg' : 'chat-msg' + (msg.name === myName ? ' cm-mine' : '');
  if (isSystem) {
    div.innerHTML = `<div class="cm-text" style="color:var(--muted);font-size:12px;text-align:center;padding:4px">${escHtml(msg.msg)}</div>`;
  } else {
    div.innerHTML = `<div class="cm-avatar">${msg.avatar || '👤'}</div>
      <div class="cm-body"><div class="cm-name">${escHtml(msg.name)}</div>
      <div class="cm-text">${escHtml(msg.msg)}</div></div>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function sendRoomChat() {
  const input = document.getElementById('roomChatInput');
  const msg = input.value.trim();
  if (!msg || !socket) return;
  socket.emit('roomChat', { msg });
  input.value = '';
}

// ─── ROOMS ─────────────────────────────────────────────────────────────────
function showCreateModal() { document.getElementById('createModal').classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

function createRoom() {
  if (!socket || !myName) return;
  const rules = {
    maxPlayers: parseInt(document.getElementById('cfMaxPlayers').value),
    gameMode: document.getElementById('cfGameMode').value,
    turnTimer: parseInt(document.getElementById('cfTurnTimer').value),
    stackDraw: document.getElementById('cfStackDraw').checked,
    jumpIn: document.getElementById('cfJumpIn').checked,
    sevenZero: document.getElementById('cfSevenZero').checked,
  };
  socket.emit('createRoom', {
    name: myName, avatar: myAvatar,
    isPublic: document.getElementById('cfPublic').checked,
    maxPlayers: rules.maxPlayers, rules
  });
  hideModal('createModal');
}

function joinRoom() {
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  if (!code || code.length !== 6) { showToast('Masukkan kode room 6 karakter!', 'error'); return; }
  if (!socket || !myName) { showToast('Masukkan nama dulu!', 'error'); return; }
  socket.emit('joinRoom', { code, name: myName, avatar: myAvatar });
}

function refreshPublicRooms() {
  if (!socket) return;
  socket.emit('getPublicRooms');
}

function renderPublicRooms(rooms) {
  const list = document.getElementById('publicRoomsList');
  if (!rooms.length) { list.innerHTML = '<div class="no-rooms">Tidak ada room publik</div>'; return; }
  list.innerHTML = '';
  rooms.forEach(r => {
    const div = document.createElement('div');
    div.className = 'public-room-item';
    div.innerHTML = `<div class="pri-info">
        <div class="pri-code">${r.code}</div>
        <div class="pri-count">Host: ${escHtml(r.hostName)} · ${r.playerCount}/${r.maxPlayers} pemain</div>
      </div>
      <div class="pri-join">Gabung →</div>`;
    div.onclick = () => {
      document.getElementById('joinCodeInput').value = r.code;
      joinRoom();
    };
    list.appendChild(div);
  });
}

function renderRoomLobby(state) {
  const myPlayer = state.players.find(p => p.name === myName);
  isHost = myPlayer?.isHost || false;

  // Rules badges
  const rl = document.getElementById('rlRules');
  rl.innerHTML = '';
  const addBadge = (label, active) => {
    const b = document.createElement('span');
    b.className = 'rule-badge' + (active ? ' active' : '');
    b.textContent = label;
    rl.appendChild(b);
  };
  addBadge(`Mode: ${state.rules.gameMode}`, true);
  addBadge(`Max: ${state.maxPlayers}P`, true);
  addBadge(`Timer: ${state.rules.turnTimer}s`, true);
  addBadge('Stack +2/+4', state.rules.stackDraw);
  addBadge('Jump-In', state.rules.jumpIn);
  addBadge('7-0 Swap', state.rules.sevenZero);

  // Players
  const pp = document.getElementById('rlPlayers');
  pp.innerHTML = '<div style="font-weight:800;font-size:14px;margin-bottom:12px;color:var(--muted)">PEMAIN (' + state.players.length + '/' + state.maxPlayers + ')</div>';

  state.players.forEach(p => {
    const slot = document.createElement('div');
    slot.className = 'player-slot';
    const kickBtn = (isHost && !p.isHost && p.id !== socket?.id)
      ? `<button class="ps-kick" onclick="kickPlayer('${p.id}')">Kick</button>` : '';
    slot.innerHTML = `<div class="ps-avatar">${p.avatar}</div>
      <div class="ps-info">
        <div class="ps-name">${escHtml(p.name)} ${p.isHost ? '<span class="ps-host">HOST</span>' : ''}</div>
        <div class="ps-role">${p.id === socket?.id ? 'Kamu' : 'Pemain'}</div>
      </div>
      ${kickBtn}`;
    pp.appendChild(slot);
  });

  // Empty slots
  for (let i = state.players.length; i < state.maxPlayers; i++) {
    const slot = document.createElement('div');
    slot.className = 'player-slot ps-empty';
    slot.textContent = 'Menunggu pemain...';
    pp.appendChild(slot);
  }

  // Start button
  const startBtn = document.getElementById('startBtn');
  if (isHost) { startBtn.classList.remove('hidden'); }
  else { startBtn.classList.add('hidden'); }
}

function kickPlayer(targetId) {
  if (!socket) return;
  socket.emit('kickPlayer', targetId);
}

function startGame() {
  if (!socket) return;
  socket.emit('startGame');
}

function leaveRoom() {
  if (!socket) return;
  socket.emit('leaveRoom');
  currentRoom = null;
  showScreen('lobbyScreen');
  refreshPublicRooms();
}

function copyCode() {
  navigator.clipboard.writeText(currentRoom || '');
  showToast('Kode disalin!', 'success');
}

// ─── UTILS ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  ['loadingScreen','nameScreen','lobbyScreen','roomLobbyScreen']
    .forEach(s => {
      const el = document.getElementById(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
