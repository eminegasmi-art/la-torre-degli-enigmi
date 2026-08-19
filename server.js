// Server "La Torre degli Enigmi" - Express + Socket.io, stato autoritativo
// tenuto in memoria (una sola fonte di verità, i client sono solo "vetrine").
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  DOOR_COUNT, TOTAL_TIME_MS,
  generateDoors, checkBoardCorrect, applyBoardUpdate,
  penaltyForAttempt, speedBonusFor,
} = require('./gameLogic');

const app = express();
app.use(express.static(__dirname));
const server = http.createServer(app);
const io = new Server(server);

const rooms = {}; // code -> room

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente 0/O/1/I ambigui
function generateCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms[code]);
  return code;
}

function publicDoorView(door) {
  if (!door) return null;
  return {
    type: door.type,
    title: door.title,
    instructions: door.instructions,
    boardKind: door.boardKind,
    board: door.board,
    choices: door.choices,
    sliderMax: door.sliderMax,
    cells: door.cells,
    sealRune: door.sealRune,
    needsRoster: door.needsRoster,
  };
}

function publicState(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    doorIndex: room.currentDoorIndex,
    totalDoors: room.doors.length || DOOR_COUNT,
    door: room.status === 'playing' ? publicDoorView(room.doors[room.currentDoorIndex]) : null,
    deadlineTs: room.status === 'playing' ? room.deadlineTs : null,
    wrongCount: room.wrongCount,
    log: room.log.slice(-40),
  };
}

function broadcastState(room) {
  io.to(room.code).emit('state', publicState(room));
  if (room.status === 'playing') {
    const door = room.doors[room.currentDoorIndex];
    room.players.forEach((p, i) => {
      if (p.connected) io.to(p.id).emit('myClue', { clue: door.clues[i] || '' });
    });
  }
}

function findRoomBySocket(socket) {
  const code = socket.data.code;
  return code ? rooms[code] : null;
}

function reassignHostIfNeeded(room) {
  if (!room.players.some((p) => p.id === room.hostId && p.connected)) {
    const next = room.players.find((p) => p.connected);
    room.hostId = next ? next.id : room.hostId;
  }
}

function cleanupIfEmpty(room) {
  if (room.players.every((p) => !p.connected)) {
    delete rooms[room.code];
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    const code = generateCode();
    const room = {
      code,
      players: [{ id: socket.id, name: (name || 'Giocatore').slice(0, 20), connected: true }],
      hostId: socket.id,
      status: 'waiting',
      doors: [],
      currentDoorIndex: 0,
      deadlineTs: null,
      wrongCount: 0,
      doorWrongAttempts: 0,
      doorStartTs: null,
      log: [],
    };
    rooms[code] = room;
    socket.join(code);
    socket.data.code = code;
    cb && cb({ ok: true, code });
    broadcastState(room);
  });

  socket.on('joinRoom', ({ name, code }, cb) => {
    const room = rooms[(code || '').toUpperCase()];
    if (!room) return cb && cb({ ok: false, error: 'Nessuna lobby trovata con questo codice.' });

    const cleanName = (name || 'Giocatore').slice(0, 20);
    if (room.status !== 'waiting') {
      const existing = room.players.find((p) => !p.connected && p.name.toLowerCase() === cleanName.toLowerCase());
      if (!existing) return cb && cb({ ok: false, error: 'La spedizione è già partita: non puoi entrare come nuovo giocatore ora.' });
      existing.id = socket.id;
      existing.connected = true;
    } else {
      if (room.players.length >= 6) return cb && cb({ ok: false, error: 'Lobby piena (massimo 6 giocatori).' });
      room.players.push({ id: socket.id, name: cleanName, connected: true });
    }
    socket.join(room.code);
    socket.data.code = room.code;
    cb && cb({ ok: true, code: room.code });
    broadcastState(room);
  });

  socket.on('startGame', (_data, cb) => {
    const room = findRoomBySocket(socket);
    if (!room) return cb && cb({ ok: false, error: 'Stanza non trovata.' });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: 'Solo chi ha fondato la lobby può iniziare.' });
    if (room.players.length < 2) return cb && cb({ ok: false, error: 'Servono almeno 2 giocatori.' });

    room.doors = generateDoors(DOOR_COUNT, room.players.length);
    room.currentDoorIndex = 0;
    room.deadlineTs = Date.now() + TOTAL_TIME_MS;
    room.wrongCount = 0;
    room.doorWrongAttempts = 0;
    room.doorStartTs = Date.now();
    room.status = 'playing';
    room.log = ['La squadra varca il portale della Torre degli Enigmi...'];
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('updateBoard', (action, cb) => {
    const room = findRoomBySocket(socket);
    if (!room || room.status !== 'playing') return cb && cb({ ok: false });
    const door = room.doors[room.currentDoorIndex];
    door.board = applyBoardUpdate(door, door.board, action);
    broadcastState(room);
    cb && cb({ ok: true });
  });

  socket.on('confirmDoor', (_data, cb) => {
    const room = findRoomBySocket(socket);
    if (!room || room.status !== 'playing') return cb && cb({ ok: false });
    const door = room.doors[room.currentDoorIndex];
    const isFinalDoor = room.currentDoorIndex === room.doors.length - 1;
    const correct = checkBoardCorrect(door, door.board);
    if (correct) {
      const elapsed = Date.now() - (room.doorStartTs || Date.now());
      const bonus = speedBonusFor(elapsed, isFinalDoor);
      if (bonus > 0) {
        room.deadlineTs += bonus;
        room.log.push(`Porta superata in fretta (${Math.round(elapsed / 1000)}s): +${bonus / 1000} secondi alla clessidra!`);
      }
      room.log.push(`Porta ${room.currentDoorIndex + 1} superata: "${door.title}"!`);
      room.currentDoorIndex++;
      room.doorWrongAttempts = 0;
      room.doorStartTs = Date.now();
      if (room.currentDoorIndex >= room.doors.length) {
        room.status = 'won';
        room.log.push('La squadra è fuggita dalla Torre! Vittoria!');
      }
    } else {
      room.wrongCount++;
      room.doorWrongAttempts++;
      const penalty = penaltyForAttempt(room.doorWrongAttempts, isFinalDoor);
      room.deadlineTs -= penalty;
      room.log.push(`Tentativo errato: la clessidra perde ${penalty / 1000} secondi.`);
      if (Date.now() >= room.deadlineTs) {
        room.status = 'lost';
        room.log.push('La sabbia è finita: la Torre vi ha inghiottiti.');
      }
    }
    cb && cb({ ok: true, correct });
    broadcastState(room);
  });

  socket.on('resetGame', (_data, cb) => {
    const room = findRoomBySocket(socket);
    if (!room) return cb && cb({ ok: false });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: 'Solo chi ha fondato la lobby può ricominciare.' });
    room.status = 'waiting';
    room.doors = [];
    room.currentDoorIndex = 0;
    room.deadlineTs = null;
    room.wrongCount = 0;
    room.doorWrongAttempts = 0;
    room.doorStartTs = null;
    room.log = [];
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (player) player.connected = false;
    reassignHostIfNeeded(room);
    cleanupIfEmpty(room);
    if (rooms[room.code]) broadcastState(room);
  });
});

// Controllo periodico: se il tempo scade mentre nessuno tocca nulla, la
// partita deve comunque terminare (non solo quando qualcuno conferma).
setInterval(() => {
  Object.values(rooms).forEach((room) => {
    if (room.status === 'playing' && room.deadlineTs && Date.now() >= room.deadlineTs) {
      room.status = 'lost';
      room.log.push('La sabbia è finita: la Torre vi ha inghiottiti.');
      broadcastState(room);
    }
  });
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`La Torre degli Enigmi in ascolto sulla porta ${PORT}`));
