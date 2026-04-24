const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 10000,
  pingInterval: 5000
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));

// ─── GAME STATE ────────────────────────────────────────────────────────────────
const rooms = {};
const playerRooms = {};  // socketId -> roomCode
const globalChat = [];

// ─── DECK GENERATOR ────────────────────────────────────────────────────────────
const COLORS = ['red', 'green', 'blue', 'yellow'];
const NUMBER_VALUES = ['0','1','2','3','4','5','6','7','8','9'];
const ACTION_VALUES = ['skip','reverse','draw2'];
const WILD_VALUES = ['wild','wild4'];

function generateDeck() {
  const deck = [];
  let id = 0;
  for (const color of COLORS) {
    // One 0 per color
    deck.push({ id: id++, color, value: '0', type: 'number' });
    // Two of each 1-9
    for (const v of NUMBER_VALUES.slice(1)) {
      deck.push({ id: id++, color, value: v, type: 'number' });
      deck.push({ id: id++, color, value: v, type: 'number' });
    }
    // Two of each action
    for (const v of ACTION_VALUES) {
      deck.push({ id: id++, color, value: v, type: 'action' });
      deck.push({ id: id++, color, value: v, type: 'action' });
    }
  }
  // 4 wilds + 4 wild4
  for (let i = 0; i < 4; i++) {
    deck.push({ id: id++, color: 'wild', value: 'wild', type: 'wild' });
    deck.push({ id: id++, color: 'wild', value: 'wild4', type: 'wild4' });
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealCards(room, count, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  for (let i = 0; i < count; i++) {
    if (room.deck.length === 0) reshuffleDeck(room);
    if (room.deck.length > 0) player.hand.push(room.deck.pop());
  }
}

function reshuffleDeck(room) {
  if (room.discardPile.length <= 1) return;
  const top = room.discardPile.pop();
  const reshuffled = shuffle(room.discardPile.map(c => ({ ...c, chosenColor: undefined })));
  room.deck = reshuffled;
  room.discardPile = [top];
  broadcastLog(room, '🔄 Deck dikocok ulang!');
}

// ─── ROOM CODE ─────────────────────────────────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms[code]);
  return code;
}

// ─── GAME HELPERS ──────────────────────────────────────────────────────────────
function getCurrentPlayer(room) {
  return room.players[room.currentTurn];
}

function getNextTurnIndex(room, skip = 1) {
  const n = room.players.length;
  let idx = room.currentTurn;
  for (let i = 0; i < skip; i++) {
    idx = ((idx + room.direction) % n + n) % n;
  }
  return idx;
}

function advanceTurn(room, skip = 1) {
  room.currentTurn = getNextTurnIndex(room, skip);
}

function isValidPlay(card, topCard, chosenColor, room) {
  const effectiveColor = topCard.chosenColor || topCard.color;
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color === effectiveColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function topCard(room) {
  return room.discardPile[room.discardPile.length - 1];
}

function broadcastState(room) {
  for (const player of room.players) {
    const sock = io.sockets.sockets.get(player.id);
    if (!sock) continue;
    const myHand = player.hand;
    const otherPlayers = room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      handCount: p.hand.length,
      isHost: p.isHost,
      afk: p.afk,
      unoCall: p.unoCall,
      connected: p.connected,
      score: p.score
    }));
    sock.emit('gameState', {
      myHand,
      players: otherPlayers,
      currentTurn: room.currentTurn,
      currentPlayerId: getCurrentPlayer(room)?.id,
      direction: room.direction,
      topCard: topCard(room),
      deckCount: room.deck.length,
      discardCount: room.discardPile.length,
      drawStack: room.drawStack,
      phase: room.phase,
      rules: room.rules,
      lastAction: room.lastAction,
      winner: room.winner,
      challengePending: room.challengePending,
      challengeTargetId: room.challengeTargetId
    });
  }
  // Spectators
  for (const specId of room.spectators) {
    const sock = io.sockets.sockets.get(specId);
    if (!sock) continue;
    sock.emit('gameState', {
      myHand: [],
      isSpectator: true,
      players: room.players.map(p => ({
        id: p.id, name: p.name, avatar: p.avatar,
        handCount: p.hand.length, isHost: p.isHost, unoCall: p.unoCall
      })),
      currentTurn: room.currentTurn,
      currentPlayerId: getCurrentPlayer(room)?.id,
      direction: room.direction,
      topCard: topCard(room),
      deckCount: room.deck.length,
      drawStack: room.drawStack,
      phase: room.phase,
      winner: room.winner
    });
  }
}

function broadcastLog(room, msg) {
  io.to(room.code).emit('gameLog', { msg, ts: Date.now() });
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobbyState', {
    code: room.code,
    players: room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar,
      isHost: p.isHost, connected: p.connected
    })),
    rules: room.rules,
    isPublic: room.isPublic,
    phase: room.phase,
    maxPlayers: room.maxPlayers
  });
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  const duration = room.rules.turnTimer || 30;
  room.turnTimerStart = Date.now();
  io.to(room.code).emit('turnTimer', { duration, playerId: getCurrentPlayer(room)?.id });
  room.turnTimerTimeout = setTimeout(() => {
    autoPlay(room);
  }, duration * 1000);
}

function clearTurnTimer(room) {
  if (room.turnTimerTimeout) {
    clearTimeout(room.turnTimerTimeout);
    room.turnTimerTimeout = null;
  }
}

function autoPlay(room) {
  const player = getCurrentPlayer(room);
  if (!player) return;
  player.afk = true;
  broadcastLog(room, `⏰ ${player.name} AFK - auto draw!`);
  dealCards(room, 1, player.id);
  room.lastAction = { type: 'draw', playerId: player.id, playerName: player.name };
  advanceTurn(room);
  broadcastState(room);
  startTurnTimer(room);
}

function checkUno(room, player) {
  if (player.hand.length === 1 && !player.unoCall) {
    // Punishment: draw 2
    setTimeout(() => {
      if (player.hand.length === 1 && !player.unoCall) {
        dealCards(room, 2, player.id);
        broadcastLog(room, `🚨 ${player.name} lupa UNO! +2 kartu!`);
        io.to(room.code).emit('unoPenalty', { playerId: player.id, playerName: player.name });
        broadcastState(room);
      }
    }, 3000);
  }
}

// ─── GAME START ────────────────────────────────────────────────────────────────
function startGame(room) {
  room.phase = 'playing';
  room.deck = shuffle(generateDeck());
  room.discardPile = [];
  room.direction = 1;
  room.currentTurn = 0;
  room.drawStack = 0;
  room.winner = null;
  room.lastAction = null;
  room.challengePending = false;
  room.challengeTargetId = null;
  room.cardHistory = [];

  // Deal 7 cards each
  for (const p of room.players) {
    p.hand = [];
    p.unoCall = false;
    p.afk = false;
    dealCards(room, 7, p.id);
  }

  // First card (must be number)
  let firstCard;
  do {
    firstCard = room.deck.pop();
    if (firstCard.type !== 'number') room.deck.unshift(firstCard);
  } while (firstCard.type !== 'number');
  room.discardPile.push(firstCard);

  io.to(room.code).emit('gameStarted', { firstCard });
  broadcastLog(room, '🎮 Game dimulai! Good luck!');
  broadcastState(room);
  startTurnTimer(room);
}

// ─── SOCKET EVENTS ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // Global chat
  socket.on('globalChat', ({ name, avatar, msg }) => {
    if (!msg || msg.trim().length === 0) return;
    const entry = { name, avatar, msg: msg.trim().slice(0, 200), ts: Date.now() };
    globalChat.push(entry);
    if (globalChat.length > 100) globalChat.shift();
    io.emit('globalChat', entry);
  });

  socket.on('getGlobalChat', () => {
    socket.emit('globalChatHistory', globalChat.slice(-50));
  });

  // Public rooms list
  socket.on('getPublicRooms', () => {
    const list = Object.values(rooms)
      .filter(r => r.isPublic && r.phase === 'lobby' && r.players.length < r.maxPlayers)
      .map(r => ({
        code: r.code,
        playerCount: r.players.length,
        maxPlayers: r.maxPlayers,
        hostName: r.players.find(p => p.isHost)?.name || '?'
      }));
    socket.emit('publicRooms', list);
  });

  // Create room
  socket.on('createRoom', ({ name, avatar, isPublic, maxPlayers, rules }) => {
    const code = generateRoomCode();
    const player = {
      id: socket.id, name, avatar,
      hand: [], isHost: true, connected: true,
      unoCall: false, afk: false, score: 0
    };
    rooms[code] = {
      code, isPublic: !!isPublic,
      maxPlayers: Math.min(10, Math.max(2, maxPlayers || 6)),
      players: [player], spectators: [],
      phase: 'lobby', deck: [], discardPile: [],
      direction: 1, currentTurn: 0, drawStack: 0,
      winner: null, lastAction: null, cardHistory: [],
      challengePending: false, challengeTargetId: null,
      prevWild4PlayerId: null,
      rules: {
        stackDraw: rules?.stackDraw !== false,
        jumpIn: !!rules?.jumpIn,
        sevenZero: !!rules?.sevenZero,
        gameMode: rules?.gameMode || 'classic',
        turnTimer: Math.min(60, Math.max(10, rules?.turnTimer || 30)),
        ...rules
      },
      turnTimerTimeout: null, turnTimerStart: null,
      chat: []
    };
    playerRooms[socket.id] = code;
    socket.join(code);
    socket.emit('roomCreated', { code });
    broadcastLobby(rooms[code]);
  });

  // Join room
  socket.on('joinRoom', ({ code, name, avatar, asSpectator }) => {
    const room = rooms[code];
    if (!room) { socket.emit('joinError', 'Room tidak ditemukan!'); return; }

    if (asSpectator) {
      room.spectators.push(socket.id);
      playerRooms[socket.id] = code;
      socket.join(code);
      socket.emit('joinedAsSpectator', { code });
      if (room.phase === 'playing') broadcastState(room);
      else broadcastLobby(room);
      return;
    }

    if (room.phase !== 'lobby') {
      // Reconnect?
      const existing = room.players.find(p => p.name === name && !p.connected);
      if (existing) {
        existing.id = socket.id;
        existing.connected = true;
        playerRooms[socket.id] = code;
        socket.join(code);
        socket.emit('reconnected', { code });
        broadcastLog(room, `🔄 ${name} reconnected!`);
        broadcastState(room);
        return;
      }
      socket.emit('joinError', 'Game sudah berjalan!');
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit('joinError', 'Room penuh!');
      return;
    }

    const player = {
      id: socket.id, name, avatar,
      hand: [], isHost: false, connected: true,
      unoCall: false, afk: false, score: 0
    };
    room.players.push(player);
    playerRooms[socket.id] = code;
    socket.join(code);
    socket.emit('roomJoined', { code });
    broadcastLog(room, `👤 ${name} bergabung!`);
    broadcastLobby(room);
  });

  // Start game (host only)
  socket.on('startGame', () => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player?.isHost) { socket.emit('error', 'Hanya host yang bisa mulai!'); return; }
    if (room.players.length < 2) { socket.emit('error', 'Minimal 2 pemain!'); return; }
    startGame(room);
  });

  // Update rules (host)
  socket.on('updateRules', (newRules) => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player?.isHost || room.phase !== 'lobby') return;
    room.rules = { ...room.rules, ...newRules };
    room.maxPlayers = Math.min(10, Math.max(2, newRules.maxPlayers || room.maxPlayers));
    broadcastLobby(room);
  });

  // Kick player (host)
  socket.on('kickPlayer', (targetId) => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player?.isHost) return;
    room.players = room.players.filter(p => p.id !== targetId);
    const targetSock = io.sockets.sockets.get(targetId);
    if (targetSock) { targetSock.emit('kicked'); targetSock.leave(code); }
    delete playerRooms[targetId];
    broadcastLog(room, `🦵 Seorang pemain di-kick!`);
    broadcastLobby(room);
  });

  // Play card
  socket.on('playCard', ({ cardId, chosenColor }) => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;

    const currentPlayer = getCurrentPlayer(room);
    if (!currentPlayer || currentPlayer.id !== socket.id) {
      socket.emit('error', 'Bukan giliran kamu!'); return;
    }

    const cardIdx = currentPlayer.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) { socket.emit('error', 'Kartu tidak ada!'); return; }

    const card = currentPlayer.hand[cardIdx];
    const top = topCard(room);

    // Stack mechanic
    if (room.drawStack > 0) {
      if (room.rules.stackDraw) {
        if (card.value !== 'draw2' && card.value !== 'wild4') {
          socket.emit('error', 'Harus main +2 atau +4 saat stack aktif!'); return;
        }
        if (top.value === 'draw2' && card.value === 'wild4') { /* allowed */ }
        else if (top.value === 'wild4' && card.value === 'draw2') {
          socket.emit('error', 'Tidak bisa stack +2 di atas +4!'); return;
        }
      } else {
        socket.emit('error', 'Kamu harus ambil kartu dulu!'); return;
      }
    }

    if (!isValidPlay(card, top, chosenColor, room)) {
      socket.emit('error', 'Kartu tidak valid!'); return;
    }

    // Wild4 challenge setup
    if (card.value === 'wild4') {
      room.prevWild4PlayerId = socket.id;
      room.prevWild4Hand = currentPlayer.hand.filter(c => c.id !== cardId).map(c => c.color);
    }

    // Remove from hand
    currentPlayer.hand.splice(cardIdx, 1);
    currentPlayer.unoCall = false;
    currentPlayer.afk = false;

    // Set chosen color for wilds
    if (card.type === 'wild' || card.type === 'wild4') {
      card.chosenColor = chosenColor || 'red';
    }

    room.discardPile.push(card);
    room.cardHistory.push({ playerId: socket.id, playerName: currentPlayer.name, card, ts: Date.now() });
    clearTurnTimer(room);

    room.lastAction = { type: 'play', playerId: socket.id, playerName: currentPlayer.name, card, chosenColor };
    io.to(room.code).emit('cardPlayed', { playerId: socket.id, playerName: currentPlayer.name, card, chosenColor });

    // Check win
    if (currentPlayer.hand.length === 0) {
      room.phase = 'ended';
      room.winner = { id: currentPlayer.id, name: currentPlayer.name };
      currentPlayer.score += 1;
      broadcastLog(room, `🏆 ${currentPlayer.name} MENANG!`);
      broadcastState(room);
      io.to(room.code).emit('gameOver', { winner: room.winner });
      return;
    }

    // Check uno
    checkUno(room, currentPlayer);

    // Handle card effects
    let skip = 1;
    if (card.value === 'skip') {
      skip = 2;
      broadcastLog(room, `⏭ ${currentPlayer.name} skip!`);
    } else if (card.value === 'reverse') {
      room.direction *= -1;
      if (room.players.length === 2) skip = 2; // reverse = skip in 2p
      broadcastLog(room, `🔄 ${currentPlayer.name} reverse!`);
    } else if (card.value === 'draw2') {
      room.drawStack += 2;
      broadcastLog(room, `+2! Stack: ${room.drawStack}`);
    } else if (card.value === 'wild4') {
      room.drawStack += 4;
      // Challenge pending
      room.challengePending = true;
      room.challengeTargetId = socket.id;
      broadcastLog(room, `🌈 Wild +4! Stack: ${room.drawStack}`);
    } else if (card.value === 'wild') {
      broadcastLog(room, `🌈 Wild! Warna: ${chosenColor}`);
    }

    // 7-0 rule
    if (room.rules.sevenZero) {
      if (card.value === '0') {
        // Rotate all hands
        const hands = room.players.map(p => p.hand);
        const rotated = room.direction === 1
          ? [hands[hands.length - 1], ...hands.slice(0, -1)]
          : [...hands.slice(1), hands[0]];
        room.players.forEach((p, i) => p.hand = rotated[i]);
        broadcastLog(room, `0️⃣ Semua tangan dirotasi!`);
      } else if (card.value === '7') {
        // Swap with chosen player - for simplicity swap with next
        const nextIdx = getNextTurnIndex(room, 1);
        const nextPlayer = room.players[nextIdx];
        const myHand = currentPlayer.hand;
        currentPlayer.hand = nextPlayer.hand;
        nextPlayer.hand = myHand;
        broadcastLog(room, `7️⃣ ${currentPlayer.name} tukar tangan dengan ${nextPlayer.name}!`);
      }
    }

    // Wild4: challenge window before advancing
    if (card.value === 'wild4' && room.challengePending) {
      advanceTurn(room, skip);
      broadcastState(room);
      // Give 5s to challenge
      room.challengeTimeout = setTimeout(() => {
        if (room.challengePending) {
          room.challengePending = false;
          // Apply drawstack to next player
          const nextP = getCurrentPlayer(room);
          if (nextP) {
            dealCards(room, room.drawStack, nextP.id);
            broadcastLog(room, `${nextP.name} ambil ${room.drawStack} kartu!`);
            room.drawStack = 0;
            advanceTurn(room, 1);
            broadcastState(room);
          }
        }
        startTurnTimer(room);
      }, 7000);
      io.to(room.code).emit('challengeWindow', { targetId: room.challengeTargetId, duration: 7 });
      return;
    }

    advanceTurn(room, skip);
    broadcastState(room);
    startTurnTimer(room);
  });

  // Draw card
  socket.on('drawCard', () => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;

    const currentPlayer = getCurrentPlayer(room);
    if (!currentPlayer || currentPlayer.id !== socket.id) return;

    clearTurnTimer(room);

    if (room.drawStack > 0) {
      dealCards(room, room.drawStack, socket.id);
      broadcastLog(room, `${currentPlayer.name} ambil ${room.drawStack} kartu!`);
      room.drawStack = 0;
      room.challengePending = false;
      advanceTurn(room);
    } else {
      dealCards(room, 1, socket.id);
      room.lastAction = { type: 'draw', playerId: socket.id, playerName: currentPlayer.name };
      // Can they play the drawn card?
      const drawn = currentPlayer.hand[currentPlayer.hand.length - 1];
      const top = topCard(room);
      if (!isValidPlay(drawn, top, null, room)) {
        advanceTurn(room);
      }
    }

    currentPlayer.afk = false;
    broadcastState(room);
    startTurnTimer(room);
  });

  // Challenge Wild+4
  socket.on('challengeWild4', () => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room || !room.challengePending) return;

    const currentPlayer = room.players.find(p => p.id === socket.id);
    if (!currentPlayer || getCurrentPlayer(room)?.id !== socket.id) return;

    const challenger = currentPlayer;
    const challenged = room.players.find(p => p.id === room.challengeTargetId);
    if (!challenged) return;

    room.challengePending = false;
    if (room.challengeTimeout) clearTimeout(room.challengeTimeout);

    // Check if challenged player had matching color
    const top2 = room.discardPile[room.discardPile.length - 2];
    const effectiveColor = top2?.chosenColor || top2?.color;
    const couldPlay = room.prevWild4Hand?.includes(effectiveColor);

    if (couldPlay) {
      // Challenge success: challenged draws 4, keep turn
      dealCards(room, 4, challenged.id);
      room.drawStack = 0;
      broadcastLog(room, `✅ Challenge berhasil! ${challenged.name} +4!`);
      io.to(room.code).emit('challengeResult', { success: true, challengedName: challenged.name });
    } else {
      // Challenge fail: challenger draws 6
      dealCards(room, room.drawStack + 2, socket.id);
      room.drawStack = 0;
      broadcastLog(room, `❌ Challenge gagal! ${challenger.name} +${room.drawStack + 2}!`);
      io.to(room.code).emit('challengeResult', { success: false, challengerName: challenger.name });
      advanceTurn(room);
    }

    broadcastState(room);
    startTurnTimer(room);
  });

  // Accept Wild+4 (no challenge)
  socket.on('acceptWild4', () => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room || !room.challengePending) return;
    if (getCurrentPlayer(room)?.id !== socket.id) return;

    room.challengePending = false;
    if (room.challengeTimeout) clearTimeout(room.challengeTimeout);

    dealCards(room, room.drawStack, socket.id);
    broadcastLog(room, `${getCurrentPlayer(room)?.name} ambil ${room.drawStack} kartu!`);
    room.drawStack = 0;
    advanceTurn(room);
    broadcastState(room);
    startTurnTimer(room);
  });

  // UNO call
  socket.on('callUno', () => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (player.hand.length <= 2) {
      player.unoCall = true;
      broadcastLog(room, `🃏 ${player.name} bilang UNO!`);
      io.to(room.code).emit('unoCall', { playerId: socket.id, playerName: player.name });
    }
  });

  // Catch UNO (report player who forgot)
  socket.on('catchUno', (targetId) => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room) return;
    const target = room.players.find(p => p.id === targetId);
    if (!target || target.hand.length !== 1 || target.unoCall) return;
    dealCards(room, 2, targetId);
    broadcastLog(room, `🚨 ${target.name} ketahuan lupa UNO! +2!`);
    io.to(room.code).emit('unoCaught', { targetId, targetName: target.name });
    broadcastState(room);
  });

  // Room chat
  socket.on('roomChat', ({ msg, emoji }) => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    const name = player?.name || 'Spectator';
    const avatar = player?.avatar || '🎮';
    if (emoji) {
      io.to(code).emit('emojiReaction', { name, avatar, emoji });
    } else if (msg?.trim()) {
      const entry = { name, avatar, msg: msg.trim().slice(0, 200), ts: Date.now() };
      room.chat.push(entry);
      if (room.chat.length > 100) room.chat.shift();
      io.to(code).emit('roomChat', entry);
    }
  });

  // Restart (host)
  socket.on('restartGame', () => {
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player?.isHost) return;
    room.phase = 'lobby';
    clearTurnTimer(room);
    broadcastLog(room, '🔃 Game di-reset oleh host!');
    broadcastLobby(room);
  });

  // Leave room
  socket.on('leaveRoom', () => {
    handleDisconnect(socket);
  });

  // ─── DEV PANEL (ryzenshiky) ─────────────────────────────────────────────────
  socket.on('devCmd', ({ cmd, payload, password }) => {
    if (password !== 'ryzenshiky') { socket.emit('devError', 'Wrong password'); return; }
    const code = playerRooms[socket.id];
    const room = rooms[code];
    if (!room) return;

    switch (cmd) {
      case 'forceWin': {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
          player.hand = [];
          room.phase = 'ended';
          room.winner = { id: player.id, name: player.name };
          io.to(room.code).emit('gameOver', { winner: room.winner });
          broadcastState(room);
        }
        break;
      }
      case 'spawnCard': {
        const player = room.players.find(p => p.id === socket.id);
        if (player && payload.card) {
          player.hand.push({ id: Date.now(), ...payload.card });
          broadcastState(room);
        }
        break;
      }
      case 'skipAll': {
        advanceTurn(room, room.players.length);
        broadcastState(room);
        startTurnTimer(room);
        break;
      }
      case 'setColor': {
        const top = topCard(room);
        if (top) top.chosenColor = payload.color;
        broadcastState(room);
        break;
      }
      case 'revealAll': {
        const allHands = room.players.map(p => ({ name: p.name, hand: p.hand }));
        socket.emit('devReveal', allHands);
        break;
      }
      case 'freezeGame': {
        clearTurnTimer(room);
        socket.emit('devAck', 'Game frozen');
        break;
      }
      case 'simulateLag': {
        setTimeout(() => {
          broadcastState(room);
          socket.emit('devAck', 'Lag simulated');
        }, payload.ms || 2000);
        break;
      }
    }
  });

  // ─── DISCONNECT ─────────────────────────────────────────────────────────────
  function handleDisconnect(sock) {
    const code = playerRooms[sock.id];
    if (!code) return;
    const room = rooms[code];
    if (!room) return;

    // Remove spectator
    room.spectators = room.spectators.filter(id => id !== sock.id);

    const playerIdx = room.players.findIndex(p => p.id === sock.id);
    if (playerIdx === -1) { delete playerRooms[sock.id]; return; }

    const player = room.players[playerIdx];

    if (room.phase === 'lobby') {
      const wasHost = player.isHost;
      room.players.splice(playerIdx, 1);
      if (wasHost && room.players.length > 0) {
        room.players[0].isHost = true;
      }
      if (room.players.length === 0) {
        delete rooms[code];
        delete playerRooms[sock.id];
        return;
      }
      broadcastLog(room, `👋 ${player.name} keluar!`);
      broadcastLobby(room);
    } else {
      // Mark disconnected, keep in game for reconnect
      player.connected = false;
      broadcastLog(room, `📡 ${player.name} disconnect! (5s reconnect window)`);
      broadcastState(room);

      // If it was their turn, auto skip after 5s
      if (getCurrentPlayer(room)?.id === sock.id) {
        setTimeout(() => {
          if (!player.connected && room.phase === 'playing') {
            autoPlay(room);
          }
        }, 5000);
      }

      // Remove if not reconnected in 60s
      setTimeout(() => {
        if (!player.connected) {
          room.players.splice(room.players.indexOf(player), 1);
          if (room.players.length < 2 && room.phase === 'playing') {
            room.phase = 'ended';
            const remaining = room.players[0];
            if (remaining) {
              room.winner = { id: remaining.id, name: remaining.name };
              io.to(room.code).emit('gameOver', { winner: room.winner });
            }
          }
          if (room.players.length === 0) delete rooms[code];
          else broadcastState(room);
        }
      }, 60000);
    }

    delete playerRooms[sock.id];
  }

  socket.on('disconnect', () => handleDisconnect(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 UNO x Ryzen server running on port ${PORT}`));
