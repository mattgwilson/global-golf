// ── Online Multiplayer ─────────────────────────────────────────────────────────

const ONLINE_COLORS = ['#00ff88', '#ff79a8'];

let _onlineRoomId = null;
let _onlineUnsub  = null;
let _lastRoomData = null;
let _onlineMyIdx  = -1;

// ── Identity ───────────────────────────────────────────────────────────────────

function getGuestId() {
  let id = localStorage.getItem('golf-guest-id');
  if (!id) {
    id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('golf-guest-id', id);
  }
  return id;
}

function myPlayerId() {
  const user = window.currentUser?.();
  return user ? user.uid : getGuestId();
}

function myDefaultName() {
  const user = window.currentUser?.();
  if (user) return user.displayName || user.email || '';
  return localStorage.getItem('golf-online-name') || '';
}

// ── Room ID ────────────────────────────────────────────────────────────────────

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── Start/target selection (seeded, mirrors game.js logic) ─────────────────────

function pickOnlineGame(mode, seed) {
  const capitals = (mode === 'us-random') ? US_STATE_CAPITALS : CAPITALS;
  const rng      = mulberry32(seed);
  const pick     = () => capitals[Math.floor(rng() * capitals.length)];
  const minDist  = (mode === 'us-random') ? MIN_US_DIST : MIN_GAME_DIST;

  let start, target, dist, attempts = 0;
  do {
    start  = pick();
    target = pick();
    dist   = haversineKm(start.lat, start.lng, target.lat, target.lng);
    attempts++;
  } while (attempts < 200 && (target.name === start.name || dist < minDist));

  const par = (mode === 'us-random') ? calcParUS(dist) : calcPar(dist);
  return { start, target, par };
}

// ── Firestore operations ───────────────────────────────────────────────────────

function slim(c) {
  return { name: c.name, country: c.country || '', lat: c.lat, lng: c.lng };
}

async function onlineCreateRoom(name, mode) {
  localStorage.setItem('golf-online-name', name);
  const roomId   = generateRoomId();
  const playerId = myPlayerId();
  const seed     = Math.floor(Math.random() * 0x7fffffff);
  const { start, target, par } = pickOnlineGame(mode, seed);

  await db.collection('rooms').doc(roomId).set({
    status:          'lobby',
    hostId:          playerId,
    mode,
    seed,
    startCity:       slim(start),
    target:          slim(target),
    par,
    activePlayerIdx: 0,
    players: [{
      id:        playerId,
      name,
      color:     ONLINE_COLORS[0],
      isHost:    true,
      current:   slim(start),
      strokes:   0,
      penalties: 0,
      shots:     [],
      finished:  false,
    }],
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  return roomId;
}

async function onlineJoinRoom(code, name) {
  localStorage.setItem('golf-online-name', name);
  const roomId = code.toUpperCase().trim();
  const ref    = db.collection('rooms').doc(roomId);
  const snap   = await ref.get();

  if (!snap.exists)              throw new Error('Room not found — check the code.');
  const data = snap.data();
  if (data.status !== 'lobby')  throw new Error('This game has already started.');
  if (data.players.length >= 2) throw new Error('Room is full.');

  const playerId = myPlayerId();
  if (data.players.some(p => p.id === playerId)) return roomId;

  await ref.update({
    players: firebase.firestore.FieldValue.arrayUnion({
      id:        playerId,
      name,
      color:     ONLINE_COLORS[1],
      isHost:    false,
      current:   slim(data.startCity),
      strokes:   0,
      penalties: 0,
      shots:     [],
      finished:  false,
    }),
  });

  return roomId;
}

async function onlineStartGame(roomId) {
  await db.collection('rooms').doc(roomId).update({ status: 'playing' });
}

// ── Push a shot ────────────────────────────────────────────────────────────────

async function onlinePushShot(shot) {
  if (!_onlineRoomId || _onlineMyIdx < 0) return;

  const myIdx = _onlineMyIdx;
  const ref   = db.collection('rooms').doc(_onlineRoomId);

  // Transaction prevents simultaneous-shot race conditions when both players
  // shoot at nearly the same time (each would otherwise overwrite the other's update).
  await db.runTransaction(async t => {
    const snap = await t.get(ref);
    if (!snap.exists) return;
    const data = snap.data();

    const me       = data.players[myIdx];
    const otherIdx = myIdx === 0 ? 1 : 0;
    const finished = shot.to.name === data.target.name;

    const updatedMe = {
      ...me,
      current:   slim(shot.to),
      strokes:   me.strokes + 1,
      penalties: me.penalties + (shot.penalty ? 1 : 0),
      shots: [...me.shots, {
        from:          { name: shot.from.name, lat: shot.from.lat, lng: shot.from.lng },
        to:            { name: shot.to.name,   lat: shot.to.lat,   lng: shot.to.lng },
        club:          shot.club,
        clubColor:     shot.clubColor || '#a78bfa',
        distKm:        shot.distKm,
        penalty:       !!shot.penalty,
        idealClub:     shot.idealClub || null,
        undershootDest: shot.undershootDest ? { name: shot.undershootDest.name } : null,
        overshoot:      !!shot.overshoot,
        strokeNumber:  me.strokes + 1,
      }],
      finished,
    };

    const updatedPlayers    = [...data.players];
    updatedPlayers[myIdx]   = updatedMe;
    const otherDone = data.players[otherIdx]?.finished ?? false;
    const gameOver  = finished && (otherDone || data.players.length < 2);

    t.update(ref, {
      players: updatedPlayers,
      status:  gameOver ? 'finished' : 'playing',
    });
  });
}

// ── Listener ───────────────────────────────────────────────────────────────────

function onlineListen(roomId, callback) {
  onlineStopListening();
  _onlineRoomId = roomId;
  _onlineUnsub  = db.collection('rooms').doc(roomId).onSnapshot(snap => {
    if (!snap.exists) return;
    _lastRoomData = snap.data();
    _onlineMyIdx  = _lastRoomData.players.findIndex(p => p.id === myPlayerId());
    callback(_lastRoomData);
  });
}

function onlineStopListening() {
  if (_onlineUnsub) { _onlineUnsub(); _onlineUnsub = null; }
  _onlineRoomId = null;
  _lastRoomData = null;
  _onlineMyIdx  = -1;
}

function onlineIsMyTurn() {
  if (!_lastRoomData || _onlineMyIdx < 0) return false;
  const me = _lastRoomData.players[_onlineMyIdx];
  return _lastRoomData.status === 'playing' && !me?.finished;
}

function onlineGetMyIdx()    { return _onlineMyIdx; }
function onlineGetRoomData() { return _lastRoomData; }
function onlineGetRoomId()   { return _onlineRoomId; }

// ── Exports ────────────────────────────────────────────────────────────────────

window.myPlayerId          = myPlayerId;
window.myDefaultName       = myDefaultName;
window.onlineCreateRoom    = onlineCreateRoom;
window.onlineJoinRoom      = onlineJoinRoom;
window.onlineStartGame     = onlineStartGame;
window.onlinePushShot      = onlinePushShot;
window.onlineListen        = onlineListen;
window.onlineStopListening = onlineStopListening;
window.onlineIsMyTurn      = onlineIsMyTurn;
window.onlineGetMyIdx      = onlineGetMyIdx;
window.onlineGetRoomData   = onlineGetRoomData;
window.onlineGetRoomId     = onlineGetRoomId;
