/* ═══════════════════════════════════════════
   UNO x RYZEN — GAME CLIENT
   ═══════════════════════════════════════════ */

// ─── URL PARAMS ────────────────────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const ROOM_CODE = urlParams.get('room');
const MY_NAME   = urlParams.get('name') || 'Player';
const MY_AVATAR = urlParams.get('avatar') || '🎮';

if (!ROOM_CODE) { window.location.href = '/'; }

// ─── STATE ─────────────────────────────────────────────────────────────────
let socket = null;
let gameState = null;
let pendingWildCard = null;
let selectedCardId = null;
let timerInterval = null;
let timerRemaining = 30;
let isDevOpen = false;
let isDebugOpen = false;
const EMOJIS = ['😂','❤️','🔥','👍','💀','🎉','🤣','😎','🤔','😱'];
const DEV_PASS = 'ryzenshiky';

// ─── AUDIO ─────────────────────────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}
function playTone(freq, duration, type='sine', vol=0.15) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(); osc.stop(ctx.currentTime + duration);
  } catch {}
}
const SFX = {
  play:    () => { playTone(520, .12, 'triangle', .2); setTimeout(() => playTone(660, .1, 'triangle', .15), 100); },
  draw:    () => playTone(330, .15, 'sine', .12),
  invalid: () => { playTone(200, .1, 'sawtooth', .1); setTimeout(() => playTone(160, .15, 'sawtooth', .08), 80); },
  skip:    () => playTone(440, .2, 'square', .1),
  reverse: () => { playTone(400, .1); setTimeout(() => playTone(300, .1), 100); setTimeout(() => playTone(400, .1), 200); },
  wild:    () => { [400,500,600,700].forEach((f,i) => setTimeout(() => playTone(f, .12, 'triangle', .15), i*60)); },
  uno:     () => { playTone(800, .15, 'square', .2); setTimeout(() => playTone(1000, .2, 'square', .25), 120); },
  win:     () => { [523,659,784,1047].forEach((f,i) => setTimeout(() => playTone(f,.25,'triangle',.2), i*120)); },
  lose:    () => { [400,350,300,250].forEach((f,i) => setTimeout(() => playTone(f,.2,'sine',.15), i*100)); },
  timer:   () => playTone(880, .08, 'square', .08),
};

// ─── INIT ──────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  document.getElementById('tbRoom').textContent = `Room: ${ROOM_CODE}`;
  buildEmojiBar();
  initSocket();
  setupKeyboard();
  // Dev btn hint
  setTimeout(() => { document.getElementById('devBtn').style.display = ''; }, 100);
});

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') { e.preventDefault(); toggleDev(); }
    if (e.key === 'F3') { e.preventDefault(); toggleDebug(); }
    if (e.key === 'Escape') { closePickers(); }
    if (e.key === 'u' || e.key === 'U') callUno();
  });
}

// ─── SOCKET ────────────────────────────────────────────────────────────────
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('joinRoom', {
      code: ROOM_CODE, name: MY_NAME, avatar: MY_AVATAR
    });
  });

  socket.on('gameState', (state) => {
    gameState = state;
    renderGame(state);
    if (isDebugOpen) updateDebug(state);
  });

  socket.on('cardPlayed', ({ playerName, card }) => {
    const sfxMap = { skip:'skip', reverse:'reverse', draw2:'draw', wild4:'wild', wild:'wild' };
    const sfx = sfxMap[card.value] || 'play';
    SFX[sfx]?.();
    showCardPlayAnimation(card);
  });

  socket.on('gameLog', ({ msg }) => addLog(msg));

  socket.on('gameOver', ({ winner }) => {
    clearTimerDisplay();
    const isWinner = winner.name === MY_NAME;
    if (isWinner) { SFX.win(); showUnoAlert('🏆 MENANG!'); }
    else { SFX.lose(); }
    document.getElementById('goEmoji').textContent  = isWinner ? '🏆' : '😢';
    document.getElementById('goTitle').textContent  = isWinner ? 'KAMU MENANG!' : 'Permainan Selesai!';
    document.getElementById('goWinner').textContent = `${winner.name} memenangkan game ini!`;
    document.getElementById('gameOverOverlay').classList.remove('hidden');
    // Save stats
    try {
      const s = JSON.parse(localStorage.getItem('unoRyzenSession') || '{}');
      if (!s.stats) s.stats = { played:0, won:0, cards:0 };
      if (isWinner) s.stats.won++;
      localStorage.setItem('unoRyzenSession', JSON.stringify(s));
    } catch {}
  });

  socket.on('unoCall', ({ playerName }) => {
    SFX.uno();
    showUnoAlert(`${playerName}: UNO!`);
    addLog(`🃏 ${playerName} bilang UNO!`);
  });

  socket.on('unoCaught', ({ targetName }) => {
    showToast(`${targetName} ketahuan lupa UNO! +2!`, 'error');
  });

  socket.on('unoPenalty', ({ playerName }) => {
    showToast(`${playerName} +2 (lupa UNO!)`, 'error');
  });

  socket.on('turnTimer', ({ duration, playerId }) => {
    startTimerDisplay(duration, playerId === socket.id);
  });

  socket.on('challengeWindow', ({ duration }) => {
    startChallengeTimer(duration);
  });

  socket.on('challengeResult', ({ success, challengedName, challengerName }) => {
    if (success) showToast(`✅ Challenge berhasil! ${challengedName} +4!`, 'success');
    else showToast(`❌ Challenge gagal! ${challengerName} +6!`, 'error');
    hideChallengePanel();
  });

  socket.on('emojiReaction', ({ name, avatar, emoji }) => {
    spawnFloatingEmoji(emoji, name);
  });

  socket.on('roomChat', (msg) => appendChat(msg));

  socket.on('error', (msg) => { showToast(msg, 'error'); SFX.invalid(); });

  socket.on('devReveal', (hands) => {
    const area = document.getElementById('devLogArea');
    area.textContent = hands.map(h => `${h.name}: ${h.hand.map(c=>`${c.color}${c.value}`).join(',')}`).join('\n');
  });

  socket.on('devAck', (msg) => {
    const area = document.getElementById('devLogArea');
    area.textContent = '[DEV] ' + msg + '\n' + area.textContent;
  });

  socket.on('disconnect', () => showToast('Koneksi terputus!', 'error'));
  socket.on('reconnect', () => showToast('Reconnected!', 'success'));
}

// ─── RENDER ────────────────────────────────────────────────────────────────
function renderGame(state) {
  renderOpponents(state);
  renderDiscardPile(state);
  renderMyHand(state);
  renderMyInfo(state);
  renderDeckCount(state);
  renderDirection(state);
  renderDrawStack(state);
  renderChallengePanel(state);
  renderUnoButton(state);
}

function renderOpponents(state) {
  const row = document.getElementById('opponentsRow');
  const opponents = state.players.filter(p => p.id !== socket.id);
  row.innerHTML = '';
  opponents.forEach(p => {
    const isActive = p.id === state.currentPlayerId;
    const div = document.createElement('div');
    div.className = 'opponent-player'
      + (isActive ? ' active' : '')
      + (p.unoCall && p.handCount === 1 ? ' uno-state' : '')
      + (p.afk ? ' op-afk' : '')
      + (!p.connected ? ' op-disconnected' : '');
    div.dataset.playerId = p.id;

    // Mini cards
    const miniCards = Array.from({ length: Math.min(p.handCount, 12) }, () =>
      `<div class="op-mini-card"></div>`).join('');

    div.innerHTML = `
      <div class="op-avatar">${p.avatar}</div>
      <div class="op-name">${escHtml(p.name)} ${p.isHost ? '👑' : ''}</div>
      <div class="op-hand">${miniCards}</div>
      <div class="op-cards">${p.handCount} kartu</div>
      ${p.unoCall && p.handCount === 1 ? '<div class="op-uno-badge">UNO</div>' : ''}
    `;

    // Click to catch UNO
    div.addEventListener('click', () => {
      if (p.handCount === 1 && !p.unoCall) {
        socket.emit('catchUno', p.id);
      }
    });

    row.appendChild(div);
  });
}

function renderDiscardPile(state) {
  const pile = document.getElementById('discardPile');
  pile.innerHTML = '';
  if (state.topCard) {
    pile.style.background = getCardBg(state.topCard);
    const card = buildCardEl(state.topCard, 'discard');
    pile.appendChild(card);
  }
}

function renderMyHand(state) {
  const hand = document.getElementById('myHand');
  const top = state.topCard;
  const isMTurn = state.currentPlayerId === socket.id;
  const hasDrawStack = state.drawStack > 0;

  hand.innerHTML = '';
  state.myHand?.forEach(card => {
    let valid = false;
    if (isMTurn) {
      if (hasDrawStack && state.rules?.stackDraw) {
        valid = card.value === 'draw2' || card.value === 'wild4';
        if (top?.value === 'draw2' && card.value === 'wild4') valid = true;
        if (top?.value === 'wild4' && card.value === 'draw2') valid = false;
      } else if (hasDrawStack && !state.rules?.stackDraw) {
        valid = false;
      } else {
        valid = isValidCard(card, top);
      }
    }

    const el = buildCardEl(card, 'hand', !valid && isMTurn);
    el.dataset.cardId = card.id;

    if (isMTurn && valid) {
      el.classList.add('highlight');
      el.addEventListener('click', () => handleCardClick(card));
    } else if (isMTurn && !valid) {
      el.classList.add('dim');
    } else {
      el.style.cursor = 'default';
    }

    hand.appendChild(el);
  });
}

function renderMyInfo(state) {
  const me = state.players?.find(p => p.id === socket.id);
  const isMTurn = state.currentPlayerId === socket.id;
  const info = document.getElementById('myInfo');
  info.innerHTML = `
    <div class="mi-avatar">${MY_AVATAR}</div>
    <div class="mi-name">${escHtml(MY_NAME)}</div>
    ${isMTurn ? '<div class="mi-turn-badge">GILIRAN MU!</div>' : ''}
    <div class="mi-count">${state.myHand?.length || 0} kartu</div>
  `;
}

function renderDeckCount(state) {
  document.getElementById('deckCount').textContent = state.deckCount + ' kartu';
  document.getElementById('discardCount').textContent = state.discardCount + ' di buang';
}

function renderDirection(state) {
  const ind = document.getElementById('directionInd');
  ind.textContent = state.direction === 1 ? '↻' : '↺';
  ind.style.color = 'rgba(255,255,255,.5)';
}

function renderDrawStack(state) {
  const badge = document.getElementById('drawStackBadge');
  if (state.drawStack > 0) {
    badge.style.display = '';
    document.getElementById('drawStackNum').textContent = '+' + state.drawStack;
  } else {
    badge.style.display = 'none';
  }
}

function renderChallengePanel(state) {
  const panel = document.getElementById('challengePanel');
  const isMyTurn = state.currentPlayerId === socket.id;
  if (state.challengePending && isMyTurn && !state.isSpectator) {
    panel.style.display = '';
  } else if (!state.challengePending) {
    panel.style.display = 'none';
  }
}

function renderUnoButton(state) {
  const btn = document.getElementById('unoBtn');
  const handLen = state.myHand?.length;
  if (handLen === 2) {
    btn.classList.add('pulsing');
  } else {
    btn.classList.remove('pulsing');
  }
}

// ─── CARD BUILDING ─────────────────────────────────────────────────────────
function buildCardEl(card, context, dimmed = false) {
  const el = document.createElement('div');
  const colorClass = card.chosenColor || card.color;
  el.className = `game-card ${colorClass}`;
  if (context === 'hand') el.classList.add('hand-card');
  if (dimmed) el.classList.add('dim');

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const oval = document.createElement('div');
  oval.className = 'card-oval';
  inner.appendChild(oval);

  if (card.type === 'wild' || card.type === 'wild4') {
    const quarters = document.createElement('div');
    quarters.className = 'wild-quarters';
    quarters.innerHTML = '<div class="wq r"></div><div class="wq b"></div><div class="wq g"></div><div class="wq y"></div>';
    inner.appendChild(quarters);
    const val = document.createElement('div');
    val.className = 'card-value';
    val.style.fontSize = '11px';
    val.textContent = card.value === 'wild4' ? '+4' : '🌈';
    inner.appendChild(val);
  } else {
    const val = document.createElement('div');
    val.className = 'card-value';
    val.textContent = getCardLabel(card.value);
    inner.appendChild(val);
  }

  // Corners
  ['tl','br'].forEach(pos => {
    const c = document.createElement('div');
    c.className = `card-corner ${pos}`;
    c.textContent = getCardLabel(card.value);
    inner.appendChild(c);
  });

  el.appendChild(inner);
  return el;
}

function getCardLabel(val) {
  const map = { skip:'⊘', reverse:'⇄', draw2:'+2', wild:'🌈', wild4:'+4' };
  return map[val] || val;
}

function getCardBg(card) {
  const color = card.chosenColor || card.color;
  const bgs = {
    red:    'linear-gradient(135deg, #e63946, #c1121f)',
    blue:   'linear-gradient(135deg, #1d84b5, #0077b6)',
    green:  'linear-gradient(135deg, #2a9d3f, #208b35)',
    yellow: 'linear-gradient(135deg, #f4a623, #e08c00)',
    wild:   'linear-gradient(135deg, #9b5de5, #7b2fd0)',
    wild4:  'linear-gradient(135deg, #9b5de5, #7b2fd0)',
  };
  return bgs[color] || 'var(--bg3)';
}

function isValidCard(card, topCard) {
  if (!topCard) return true;
  if (card.type === 'wild' || card.type === 'wild4') return true;
  const effColor = topCard.chosenColor || topCard.color;
  return card.color === effColor || card.value === topCard.value;
}

// ─── ACTIONS ───────────────────────────────────────────────────────────────
function handleCardClick(card) {
  if (!socket || !gameState) return;
  if (gameState.currentPlayerId !== socket.id) return;

  if (card.type === 'wild' || card.type === 'wild4') {
    pendingWildCard = card;
    // Mobile: full overlay; Desktop: inline picker
    if (window.innerWidth < 600) {
      document.getElementById('wildOverlay').classList.remove('hidden');
    } else {
      document.getElementById('colorPicker').style.display = '';
    }
  } else {
    playCard(card.id, null);
  }
}

function playCard(cardId, chosenColor) {
  socket.emit('playCard', { cardId, chosenColor });
  closePickers();
}

function pickColor(color) {
  if (!pendingWildCard) return;
  playCard(pendingWildCard.id, color);
  pendingWildCard = null;
}

function pickColorOverlay(color) {
  document.getElementById('wildOverlay').classList.add('hidden');
  pickColor(color);
}

function drawCard() {
  if (!socket || !gameState) return;
  if (gameState.currentPlayerId !== socket.id) return;
  if (gameState.challengePending) return;
  socket.emit('drawCard');
  SFX.draw();
}

function callUno() {
  if (!socket) return;
  socket.emit('callUno');
}

function challengeWild4() {
  socket.emit('challengeWild4');
  hideChallengePanel();
}

function acceptWild4() {
  socket.emit('acceptWild4');
  hideChallengePanel();
}

function hideChallengePanel() {
  document.getElementById('challengePanel').style.display = 'none';
  clearInterval(window.chalTimerInt);
}

function closePickers() {
  document.getElementById('colorPicker').style.display = 'none';
  document.getElementById('wildOverlay').classList.add('hidden');
}

// ─── CHALLENGE TIMER ───────────────────────────────────────────────────────
function startChallengeTimer(duration) {
  const isMyTurn = gameState?.currentPlayerId === socket.id;
  if (!isMyTurn) return;
  let t = duration;
  document.getElementById('challengePanel').style.display = '';
  document.getElementById('chalTimer').textContent = t;
  clearInterval(window.chalTimerInt);
  window.chalTimerInt = setInterval(() => {
    t--;
    document.getElementById('chalTimer').textContent = t;
    if (t <= 0) clearInterval(window.chalTimerInt);
  }, 1000);
}

// ─── TURN TIMER ────────────────────────────────────────────────────────────
function startTimerDisplay(duration, isMe) {
  clearTimerDisplay();
  timerRemaining = duration;
  const numEl = document.getElementById('ttNum');
  const ringEl = document.getElementById('ttRing');

  numEl.textContent = timerRemaining;
  ringEl.classList.remove('urgent');

  timerInterval = setInterval(() => {
    timerRemaining--;
    numEl.textContent = timerRemaining;
    if (timerRemaining <= 10) {
      ringEl.classList.add('urgent');
      if (isMe) SFX.timer();
    }
    if (timerRemaining <= 0) clearTimerDisplay();
  }, 1000);
}

function clearTimerDisplay() {
  clearInterval(timerInterval);
  const numEl = document.getElementById('ttNum');
  const ringEl = document.getElementById('ttRing');
  if (numEl) numEl.textContent = '';
  if (ringEl) ringEl.classList.remove('urgent');
}

// ─── ANIMATIONS ────────────────────────────────────────────────────────────
function showCardPlayAnimation(card) {
  const pile = document.getElementById('discardPile');
  pile.style.transform = 'scale(1.08)';
  setTimeout(() => pile.style.transform = '', 300);
}

// ─── CHAT ──────────────────────────────────────────────────────────────────
function buildEmojiBar() {
  const bar = document.getElementById('scEmojiRow');
  bar.innerHTML = '';
  EMOJIS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'sc-emoji-btn';
    btn.textContent = e;
    btn.onclick = () => {
      socket?.emit('roomChat', { emoji: e });
    };
    bar.appendChild(btn);
  });
}

function appendChat(msg) {
  const container = document.getElementById('scMessages');
  const div = document.createElement('div');
  div.className = 'sc-msg' + (msg.name === MY_NAME ? ' mine' : '');
  div.innerHTML = `<div class="scm-av">${msg.avatar || '👤'}</div>
    <div class="scm-body"><div class="scm-name">${escHtml(msg.name)}</div>
    <div class="scm-text">${escHtml(msg.msg)}</div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function sendRoomChat() {
  const input = document.getElementById('scInput');
  const msg = input.value.trim();
  if (!msg || !socket) return;
  socket.emit('roomChat', { msg });
  input.value = '';
}

function spawnFloatingEmoji(emoji, name) {
  const area = document.getElementById('emojiFloatArea');
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = (20 + Math.random() * 60) + 'vw';
  el.style.bottom = '15vh';
  area.appendChild(el);
  setTimeout(() => area.removeChild(el), 2100);
}

// ─── LOG ───────────────────────────────────────────────────────────────────
function addLog(msg) {
  const container = document.getElementById('logMessages');
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.textContent = msg;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ─── PANELS ────────────────────────────────────────────────────────────────
function toggleChat() {
  const chat = document.getElementById('sideChat');
  chat.classList.toggle('open');
  document.getElementById('sideLog').classList.remove('open');
}
function toggleLog() {
  const log = document.getElementById('sideLog');
  log.classList.toggle('open');
  document.getElementById('sideChat').classList.remove('open');
}
function toggleDev() {
  isDevOpen = !isDevOpen;
  document.getElementById('devPanel').classList.toggle('hidden', !isDevOpen);
}
function toggleDebug() {
  isDebugOpen = !isDebugOpen;
  document.getElementById('debugPanel').classList.toggle('hidden', !isDebugOpen);
  if (isDebugOpen && gameState) updateDebug(gameState);
}

function updateDebug(state) {
  const content = document.getElementById('debugContent');
  content.textContent = JSON.stringify({
    phase: state.phase,
    currentPlayerId: state.currentPlayerId,
    direction: state.direction,
    drawStack: state.drawStack,
    deckCount: state.deckCount,
    discardCount: state.discardCount,
    topCard: state.topCard,
    myHandCount: state.myHand?.length,
    challengePending: state.challengePending,
    playerCounts: state.players?.map(p => `${p.name}: ${p.handCount}`)
  }, null, 2);
}

// ─── DEV COMMANDS ──────────────────────────────────────────────────────────
function devCmd(cmd, payload = {}) {
  socket?.emit('devCmd', { cmd, payload, password: DEV_PASS });
}
function devRevealAll() { devCmd('revealAll'); }
function devSimLag() {
  const ms = parseInt(prompt('Lag delay (ms)?', '2000')) || 2000;
  devCmd('simulateLag', { ms });
}
function devSetColor() {
  const c = prompt('Warna (red/blue/green/yellow)?', 'red');
  if (c) devCmd('setColor', { color: c });
}
function devSpawnCard() {
  const color = document.getElementById('devSpawnColor').value;
  const value = document.getElementById('devSpawnValue').value;
  const typeMap = { wild:'wild', wild4:'wild4', skip:'action', reverse:'action', draw2:'action' };
  const type = typeMap[value] || 'number';
  devCmd('spawnCard', { card: { color, value, type } });
}

// ─── GAME CONTROLS ─────────────────────────────────────────────────────────
function requestRestart() {
  socket?.emit('restartGame');
  document.getElementById('gameOverOverlay').classList.add('hidden');
  window.location.href = `/?room=${ROOM_CODE}`;
}

function leaveGame() {
  socket?.emit('leaveRoom');
  window.location.href = '/';
}

// ─── UNO ALERT ─────────────────────────────────────────────────────────────
function showUnoAlert(text = 'UNO!') {
  const el = document.getElementById('unoAlert');
  el.textContent = text;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 1200);
}

// ─── TOAST ─────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ─── UTILS ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
