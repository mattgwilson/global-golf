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

function generateCourseHoles(mode, seed, numHoles) {
  const capitals = (mode === 'us-random') ? US_STATE_CAPITALS : CAPITALS;
  const rng      = mulberry32(seed);
  const pick     = () => capitals[Math.floor(rng() * capitals.length)];
  const minDist  = (mode === 'us-random') ? MIN_US_DIST : MIN_GAME_DIST;

  return Array.from({ length: numHoles }, () => {
    let start, target, dist, attempts = 0;
    do {
      start  = pick();
      target = pick();
      dist   = haversineKm(start.lat, start.lng, target.lat, target.lng);
      attempts++;
    } while (attempts < 200 && (target.name === start.name || dist < minDist));
    const par = (mode === 'us-random') ? calcParUS(dist) : calcPar(dist);
    return { startCity: slim(start), targetCity: slim(target), par };
  });
}

// ── Firestore operations ───────────────────────────────────────────────────────

function slim(c) {
  return { name: c.name, country: c.country || '', lat: c.lat, lng: c.lng };
}

async function onlineCreateRoom(name, mode, options = {}) {
  localStorage.setItem('golf-online-name', name);
  const roomId   = generateRoomId();
  const playerId = myPlayerId();
  const seed     = Math.floor(Math.random() * 0x7fffffff);
  const isCourse = options.gameType === 'course';

  let docData;

  if (isCourse) {
    const numHoles = options.numHoles || 3;
    const holes    = generateCourseHoles(mode, seed, numHoles);
    const first    = holes[0];
    docData = {
      status:         'lobby',
      hostId:         playerId,
      mode,
      gameType:       'course',
      numHoles,
      currentHoleIdx: 0,
      courseHoles:    holes,
      seed,
      startCity:      first.startCity,
      target:         first.targetCity,
      par:            first.par,
      players: [{
        id:         playerId,
        name,
        color:      ONLINE_COLORS[0],
        isHost:     true,
        current:    first.startCity,
        strokes:    0,
        penalties:  0,
        shots:      [],
        finished:   false,
        holeScores: [],
      }],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
  } else {
    const { start, target, par } = pickOnlineGame(mode, seed);
    docData = {
      status:         'lobby',
      hostId:         playerId,
      mode,
      gameType:       'single',
      seed,
      startCity:      slim(start),
      target:         slim(target),
      par,
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
    };
  }

  await db.collection('rooms').doc(roomId).set(docData);
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

  const newPlayer = {
    id:        playerId,
    name,
    color:     ONLINE_COLORS[1],
    isHost:    false,
    current:   slim(data.startCity),
    strokes:   0,
    penalties: 0,
    shots:     [],
    finished:  false,
  };
  if (data.gameType === 'course') newPlayer.holeScores = [];

  await ref.update({
    players: firebase.firestore.FieldValue.arrayUnion(newPlayer),
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
  // shoot at nearly the same time.
  await db.runTransaction(async t => {
    const snap = await t.get(ref);
    if (!snap.exists) return;
    const data = snap.data();

    const me      = data.players[myIdx];
    const finished = shot.to.name === data.target.name;

    const updatedMe = {
      ...me,
      current:   slim(shot.to),
      strokes:   me.strokes + 1,
      penalties: me.penalties + (shot.penalty ? 1 : 0),
      shots: [...me.shots, {
        from:           { name: shot.from.name, lat: shot.from.lat, lng: shot.from.lng },
        to:             { name: shot.to.name,   lat: shot.to.lat,   lng: shot.to.lng },
        club:           shot.club,
        clubColor:      shot.clubColor || '#a78bfa',
        distKm:         shot.distKm,
        penalty:        !!shot.penalty,
        idealClub:      shot.idealClub || null,
        undershootDest: shot.undershootDest ? { name: shot.undershootDest.name } : null,
        overshoot:      !!shot.overshoot,
        strokeNumber:   me.strokes + 1,
      }],
      finished,
    };

    const updatedPlayers  = [...data.players];
    updatedPlayers[myIdx] = updatedMe;

    let newStatus = data.status;

    if (data.gameType === 'course') {
      const allFinished = updatedPlayers.every(p => p.finished);
      if (allFinished) {
        // Record hole score for each player
        const hole = data.courseHoles[data.currentHoleIdx];
        updatedPlayers.forEach((p, i) => {
          const total      = p.strokes + p.penalties;
          const vspar      = total - hole.par;
          const holeScores = [...(p.holeScores || []), { total, vspar }];
          updatedPlayers[i] = { ...p, holeScores };
        });
        const isLastHole = data.currentHoleIdx >= data.numHoles - 1;
        newStatus = isLastHole ? 'finished' : 'hole-complete';
      }
    } else {
      const otherIdx  = myIdx === 0 ? 1 : 0;
      const otherDone = data.players[otherIdx]?.finished ?? false;
      const gameOver  = finished && (otherDone || data.players.length < 2);
      if (gameOver) newStatus = 'finished';
    }

    t.update(ref, { players: updatedPlayers, status: newStatus });
  });
}

// ── Advance to next hole (host only) ──────────────────────────────────────────

async function onlineAdvanceHole() {
  if (!_onlineRoomId) return;
  const ref = db.collection('rooms').doc(_onlineRoomId);

  await db.runTransaction(async t => {
    const snap = await t.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    if (data.status !== 'hole-complete') return;

    const nextIdx   = data.currentHoleIdx + 1;
    const nextHole  = data.courseHoles[nextIdx];
    const startCity = nextHole.startCity;

    const updatedPlayers = data.players.map(p => ({
      ...p,
      current:   startCity,
      strokes:   0,
      penalties: 0,
      shots:     [],
      finished:  false,
    }));

    t.update(ref, {
      players:        updatedPlayers,
      currentHoleIdx: nextIdx,
      target:         nextHole.targetCity,
      par:            nextHole.par,
      status:         'playing',
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
window.onlineAdvanceHole   = onlineAdvanceHole;
window.onlineListen        = onlineListen;
window.onlineStopListening = onlineStopListening;
window.onlineIsMyTurn      = onlineIsMyTurn;
window.onlineGetMyIdx      = onlineGetMyIdx;
window.onlineGetRoomData   = onlineGetRoomData;
window.onlineGetRoomId     = onlineGetRoomId;
