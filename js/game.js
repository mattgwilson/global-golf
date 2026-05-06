const DRIVER_DIST = 8000;
const MIN_GAME_DIST = 9000;
const MIN_US_DIST   = 400;

const CLUBS = [
  { name: 'Putter',  ideal: 800,  label: '800 km',   color: '#00cec9' },
  { name: '9-Iron',  ideal: 1600, label: '1,600 km', color: '#6c5ce7' },
  { name: '8-Iron',  ideal: 2400, label: '2,400 km', color: '#a29bfe' },
  { name: '7-Iron',  ideal: 3200, label: '3,200 km', color: '#fd79a8' },
  { name: '6-Iron',  ideal: 4000, label: '4,000 km', color: '#fdcb6e' },
  { name: '5-Iron',  ideal: 4800, label: '4,800 km', color: '#e17055' },
  { name: '4-Iron',  ideal: 5600, label: '5,600 km', color: '#d63031' },
  { name: '3-Iron',  ideal: 6400, label: '6,400 km', color: '#00b894' },
  { name: '3-Wood',  ideal: 7200, label: '7,200 km', color: '#0984e3' },
  { name: 'Driver',  ideal: 8000, label: '8,000 km', color: '#ff7675' },
];

const US_CLUBS = [
  { name: 'Putter',  ideal:  250, label: '250 km',   color: '#00cec9' },
  { name: '9-Iron',  ideal:  500, label: '500 km',   color: '#6c5ce7' },
  { name: '8-Iron',  ideal:  750, label: '750 km',   color: '#a29bfe' },
  { name: '7-Iron',  ideal: 1000, label: '1,000 km', color: '#fd79a8' },
  { name: '6-Iron',  ideal: 1250, label: '1,250 km', color: '#fdcb6e' },
  { name: '5-Iron',  ideal: 1500, label: '1,500 km', color: '#e17055' },
  { name: '4-Iron',  ideal: 1750, label: '1,750 km', color: '#d63031' },
  { name: '3-Iron',  ideal: 2000, label: '2,000 km', color: '#00b894' },
  { name: '3-Wood',  ideal: 2500, label: '2,500 km', color: '#0984e3' },
  { name: 'Driver',  ideal: 3000, label: '3,000 km', color: '#ff7675' },
];

const US_PENALTY_MARGIN = 150;

const PLAYER_COLORS = ['#00ff88', '#ff79a8', '#fdcb6e', '#a78bfa'];

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getDailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function calcPar(distanceKm) {
  if (distanceKm <= DRIVER_DIST * 1.5) return 3;
  if (distanceKm <= DRIVER_DIST * 2)   return 4;
  return 5;
}

function calcParUS(distanceKm) {
  if (distanceKm <= 2000) return 2;
  if (distanceKm <= 4500) return 3;
  return 4;
}

function getUSDailySeed() {
  const d = new Date();
  return (d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) * 53 + 7;
}

function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function findCapital(input, list) {
  list = list || CAPITALS;
  const query = normalize(input);
  if (!query) return null;

  let match = list.find(c => normalize(c.name) === query);
  if (match) return match;

  match = list.find(c => normalize(c.country) === query);
  if (match) return match;

  match = list.find(c => normalize(c.name).startsWith(query));
  if (match) return match;

  if (query.length >= 3) {
    match = list.find(c => normalize(c.name).includes(query));
    if (match) return match;
  }

  if (query.length >= 3) {
    match = list.find(c => {
      const cn = normalize(c.name);
      return cn.length >= 3 && query.includes(cn);
    });
    if (match) return match;
  }

  return null;
}

const PENALTY_MARGIN = 400;

function getClubForDistance(distKm, clubs) {
  clubs = clubs || CLUBS;
  return clubs.reduce((best, club) =>
    Math.abs(distKm - club.ideal) < Math.abs(distKm - best.ideal) ? club : best
  , clubs[0]);
}

function bearingRad(lat1, lng1, lat2, lng2) {
  const toRad = x => x * Math.PI / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  return Math.atan2(
    Math.sin(Δλ) * Math.cos(φ2),
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  );
}

function crossTrackKm(aLat, aLng, bLat, bLng, pLat, pLng) {
  const R   = 6371;
  const d   = haversineKm(aLat, aLng, pLat, pLng) / R;
  const θAP = bearingRad(aLat, aLng, pLat, pLng);
  const θAB = bearingRad(aLat, aLng, bLat, bLng);
  return Math.abs(Math.asin(Math.sin(d) * Math.sin(θAP - θAB)) * R);
}

function findOvershootCapital(from, to, targetDist, capitals) {
  capitals = capitals || CAPITALS;
  const θAB = bearingRad(from.lat, from.lng, to.lat, to.lng);

  for (const toleranceKm of [800, 1500, 2500]) {
    let best = null, bestDiff = Infinity;
    for (const cap of capitals) {
      if (cap.name === from.name || cap.name === to.name) continue;
      const capDist = haversineKm(from.lat, from.lng, cap.lat, cap.lng);
      if (capDist > targetDist) continue;

      const θAP = bearingRad(from.lat, from.lng, cap.lat, cap.lng);
      let angleDiff = Math.abs(θAP - θAB);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      if (angleDiff > Math.PI / 2) continue;

      const xt = crossTrackKm(from.lat, from.lng, to.lat, to.lng, cap.lat, cap.lng);
      if (xt > toleranceKm) continue;

      const diff = Math.abs(capDist - targetDist);
      if (diff < bestDiff) { bestDiff = diff; best = cap; }
    }
    if (best) return best;
  }

  {
    let best = null, bestDiff = Infinity;
    for (const cap of capitals) {
      if (cap.name === from.name) continue;
      const capDist = haversineKm(from.lat, from.lng, cap.lat, cap.lng);
      if (capDist > targetDist) continue;

      const θAP = bearingRad(from.lat, from.lng, cap.lat, cap.lng);
      let angleDiff = Math.abs(θAP - θAB);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      if (angleDiff > Math.PI / 2) continue;

      const diff = Math.abs(capDist - targetDist);
      if (diff < bestDiff) { bestDiff = diff; best = cap; }
    }
    if (best) return best;
  }

  return null;
}

function isPenalty(clubName, distKm, clubs, margin) {
  clubs  = clubs  || CLUBS;
  margin = margin !== undefined ? margin : PENALTY_MARGIN;
  const club = clubs.find(c => c.name === clubName);
  if (!club) return true;
  if (club.name === 'Putter') {
    if (distKm <= club.ideal) return false;
    return distKm > club.ideal + margin;
  }
  return Math.abs(distKm - club.ideal) > margin;
}

// ── Multiplayer helpers ────────────────────────────────────────────────────────

function createPlayer(name, color, isAI = false, difficulty = null) {
  return {
    name, color, isAI, difficulty,
    current: null, strokes: 0, penalties: 0,
    shots: [], finished: false, finishOrder: null,
  };
}

function computeAIShot(fromCity, target, difficulty, capitals, clubs) {
  capitals = capitals || CAPITALS;
  clubs    = clubs    || CLUBS;
  const totalDist     = Math.round(haversineKm(fromCity.lat, fromCity.lng, target.lat, target.lng));
  const targetBearing = bearingRad(fromCity.lat, fromCity.lng, target.lat, target.lng);

  // ── Step 1: find cities that REDUCE remaining distance ─────────────────────
  // This guarantees forward progress every shot — no infinite loops possible.
  let candidates = capitals.filter(cap => {
    if (cap.name === fromCity.name) return false;
    const remaining = haversineKm(cap.lat, cap.lng, target.lat, target.lng);
    if (remaining >= totalDist) return false; // must get closer
    const capBearing = bearingRad(fromCity.lat, fromCity.lng, cap.lat, cap.lng);
    let angleDiff = Math.abs(capBearing - targetBearing);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
    return angleDiff < Math.PI / 2;
  });

  // Directional fallback: any capital closer to target regardless of angle
  if (candidates.length === 0) {
    candidates = capitals.filter(cap =>
      cap.name !== fromCity.name &&
      haversineKm(cap.lat, cap.lng, target.lat, target.lng) < totalDist
    );
  }

  if (candidates.length === 0) return null; // should never happen with a full capitals list

  // Sort best → worst (least remaining distance first)
  candidates.sort((a, b) =>
    haversineKm(a.lat, a.lng, target.lat, target.lng) -
    haversineKm(b.lat, b.lng, target.lat, target.lng)
  );

  // ── Step 2a: hard mode "hero shot" (20% chance) ───────────────────────────
  // Pick the FARTHEST valid city in the target direction instead of the most
  // direct route. Covers maximum distance per shot → birdie finishes possible.
  if (difficulty === 'hard' && Math.random() < 0.20) {
    const hero = [...candidates].sort((a, b) =>
      haversineKm(fromCity.lat, fromCity.lng, b.lat, b.lng) -
      haversineKm(fromCity.lat, fromCity.lng, a.lat, a.lng)
    )[0];
    const dist = Math.round(haversineKm(fromCity.lat, fromCity.lng, hero.lat, hero.lng));
    return { clubName: getClubForDistance(dist, clubs).name, dest: hero };
  }

  // ── Step 2b: pick destination based on city-selection quality ──────────────
  const pct      = difficulty === 'hard' ? 0.05 : difficulty === 'medium' ? 0.20 : 0.40;
  const poolSize = Math.max(1, Math.ceil(candidates.length * pct));
  const dest     = candidates[Math.floor(Math.random() * poolSize)];

  // ── Step 3: choose club — misclub rate drives the score distribution ────────
  // Target averages:  easy ≈ +3 (80% misclub), medium ≈ +2 (65%), hard ≈ +0.5 (20%)
  const actualDist  = Math.round(haversineKm(fromCity.lat, fromCity.lng, dest.lat, dest.lng));
  const correctClub = getClubForDistance(actualDist, clubs);
  const correctIdx  = clubs.indexOf(correctClub);

  const misclubRate = difficulty === 'hard' ? 0.20 : difficulty === 'medium' ? 0.65 : 0.80;
  let clubIdx;
  if (Math.random() < misclubRate) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    clubIdx = Math.max(0, Math.min(clubs.length - 1, correctIdx + dir));
  } else {
    clubIdx = correctIdx;
  }

  return { clubName: clubs[clubIdx].name, dest };
}

// ── GameState ──────────────────────────────────────────────────────────────────

class GameState {
  constructor() { this.reset(); }

  reset() {
    this.mode           = null;
    this.players        = [];
    this.activePlayerIdx = 0;
    this.target         = null;
    this.par            = 0;
    this.finished       = false;
    this.selectedClub   = null;
    this.activeCapitals  = CAPITALS;
    this.activeClubs     = CLUBS;
    this.penaltyMargin   = PENALTY_MARGIN;
    this.capitalType     = 'world capital';
  }

  // ── Compat getters delegating to the active player ──
  get current()   { return this.players[this.activePlayerIdx]?.current   ?? null; }
  get strokes()   { return this.players[this.activePlayerIdx]?.strokes   ?? 0; }
  get penalties() { return this.players[this.activePlayerIdx]?.penalties ?? 0; }
  get shots()     { return this.players[this.activePlayerIdx]?.shots     ?? []; }
  get activePlayer() { return this.players[this.activePlayerIdx]; }

  get score() { return (this.strokes + this.penalties) - this.par; }

  get scoreLabel() {
    const s = this.score;
    if (this.strokes === 0) return '';
    if (s === -3) return 'Albatross';
    if (s === -2) return 'Eagle';
    if (s === -1) return 'Birdie';
    if (s === 0)  return 'Par';
    if (s === 1)  return 'Bogey';
    if (s === 2)  return 'Double Bogey';
    if (s === 3)  return 'Triple Bogey';
    return `+${s}`;
  }

  isSinglePlayer() {
    return this.mode === 'daily' || this.mode === 'random' ||
           this.mode === 'us-daily' || this.mode === 'us-random';
  }

  start(mode, options = {}) {
    this.reset();
    this.mode = mode;

    const isUSMode = mode === 'us-daily' || mode === 'us-random';
    this.activeCapitals = isUSMode ? US_STATE_CAPITALS : CAPITALS;
    this.activeClubs    = isUSMode ? US_CLUBS           : CLUBS;
    this.penaltyMargin  = isUSMode ? US_PENALTY_MARGIN  : PENALTY_MARGIN;
    this.capitalType    = isUSMode ? 'US state capital' : 'world capital';

    if (mode === 'daily' || mode === 'random' || isUSMode) {
      this.players = [createPlayer('You', PLAYER_COLORS[0])];
    } else if (mode === '1v1') {
      const names = options.names || ['Player 1', 'Player 2'];
      this.players = names.map((name, i) => createPlayer(name, PLAYER_COLORS[i]));
    } else if (mode === 'vs-cpu') {
      const diff = options.difficulty || 'medium';
      this.players = [
        createPlayer(options.playerName || 'You', PLAYER_COLORS[0]),
        createPlayer(`CPU (${diff.charAt(0).toUpperCase() + diff.slice(1)})`, PLAYER_COLORS[1], true, diff),
      ];
    } else if (mode === 'battle') {
      const names = options.names || Array.from({ length: options.count || 2 }, (_, i) => `Player ${i + 1}`);
      this.players = names.map((name, i) => createPlayer(name, PLAYER_COLORS[i % PLAYER_COLORS.length]));
    }

    let rand;
    if (mode === 'daily') {
      rand = mulberry32(getDailySeed());
    } else if (mode === 'us-daily') {
      rand = mulberry32(getUSDailySeed());
    } else {
      rand = mulberry32(Math.floor(Math.random() * 1e9));
    }

    const minDist = isUSMode ? MIN_US_DIST : MIN_GAME_DIST;
    const pick    = () => this.activeCapitals[Math.floor(rand() * this.activeCapitals.length)];
    let start, target, dist;
    let attempts = 0;
    do {
      start  = pick();
      target = pick();
      dist   = haversineKm(start.lat, start.lng, target.lat, target.lng);
      attempts++;
    } while (attempts < 200 && (target.name === start.name || dist < minDist));

    this.players.forEach(p => { p.current = start; });
    this.target = target;
    this.par    = isUSMode ? calcParUS(dist) : calcPar(dist);
  }

  shoot(clubName, cityInput) {
    if (this.finished) return { error: 'Game already finished.' };
    if (!clubName)     return { error: 'Select a club first.' };

    const player = this.players[this.activePlayerIdx];
    if (player.finished) return { error: `${player.name} already reached the target!` };

    const dest = typeof cityInput === 'string' ? findCapital(cityInput, this.activeCapitals) : cityInput;
    if (!dest) return { error: `"${cityInput}" is not a recognised ${this.capitalType}. Try again — no stroke used.` };
    if (dest.name === player.current.name) return { error: `You're already in ${player.current.name}!` };

    const distKm  = Math.round(haversineKm(player.current.lat, player.current.lng, dest.lat, dest.lng));
    const penalty = isPenalty(clubName, distKm, this.activeClubs, this.penaltyMargin);
    const clubObj = this.activeClubs.find(c => c.name === clubName);

    let actualDest    = dest;
    let overshootDest = null;
    if (clubObj && distKm > clubObj.ideal + PENALTY_MARGIN) {
      const landing = findOvershootCapital(player.current, dest, clubObj.ideal, this.activeCapitals);
      if (landing) {
        overshootDest = dest;
        actualDest    = landing;
      } else {
        return { error: `${clubName} can only reach ${clubObj.ideal.toLocaleString()} km — no capital exists within that range in that direction. Try a longer club. No stroke used.` };
      }
    }

    const actualDistKm = actualDest === dest
      ? distKm
      : Math.round(haversineKm(player.current.lat, player.current.lng, actualDest.lat, actualDest.lng));

    player.strokes++;
    if (penalty) player.penalties++;

    const shot = {
      from: player.current,
      to:   actualDest,
      club: clubName,
      clubColor:    clubObj ? clubObj.color : '#ff7675',
      distKm:       actualDistKm,
      penalty,
      idealClub:    getClubForDistance(actualDistKm, this.activeClubs).name,
      strokeNumber: player.strokes,
      overshootDest,
      playerIdx:    this.activePlayerIdx,
      playerColor:  player.color,
      playerName:   player.name,
    };
    player.shots.push(shot);
    player.current = actualDest;

    const playerFinished = actualDest.name === this.target.name;
    if (playerFinished) {
      player.finished    = true;
      player.finishOrder = this.players.filter(p => p.finished).length;
    }

    const gameFinished = this.players.every(p => p.finished);
    this.finished = gameFinished;

    // Advance to next player in multiplayer (even if current player just finished)
    if (!gameFinished && this.players.length > 1) {
      this._advancePlayer();
    }

    return { shot, finished: gameFinished, playerFinished };
  }

  // AI takes its shot automatically; returns same shape as shoot()
  shootAI() {
    const player = this.players[this.activePlayerIdx];
    if (!player.isAI || player.finished) return null;

    const aiResult = computeAIShot(player.current, this.target, player.difficulty, this.activeCapitals, this.activeClubs);
    if (!aiResult) return null;

    // Pass the capital object directly (bypasses string lookup)
    return this.shoot(aiResult.clubName, aiResult.dest.name);
  }

  _advancePlayer() {
    const total = this.players.length;
    let next = (this.activePlayerIdx + 1) % total;
    let attempts = 0;
    while (this.players[next].finished && attempts < total) {
      next = (next + 1) % total;
      attempts++;
    }
    this.activePlayerIdx = next;
  }

  // Force-finish the active player (used to cap easy AI at max strokes)
  forfeitPlayer() {
    const player = this.players[this.activePlayerIdx];
    player.finished    = true;
    player.forfeited   = true;
    player.finishOrder = this.players.filter(p => p.finished).length;

    const gameFinished = this.players.every(p => p.finished);
    this.finished = gameFinished;

    if (!gameFinished && this.players.length > 1) {
      this._advancePlayer();
    }
    return { finished: gameFinished };
  }

  // Final leaderboard sorted by total strokes then finish order
  leaderboard() {
    return [...this.players].sort((a, b) => {
      const ta = a.strokes + a.penalties;
      const tb = b.strokes + b.penalties;
      if (ta !== tb) return ta - tb;
      if (a.finishOrder !== b.finishOrder) {
        if (a.finishOrder === null) return 1;
        if (b.finishOrder === null) return -1;
        return a.finishOrder - b.finishOrder;
      }
      return 0;
    });
  }
}

window.CLUBS          = CLUBS;
window.US_CLUBS       = US_CLUBS;
window.PLAYER_COLORS  = PLAYER_COLORS;
window.GameState      = GameState;
window.haversineKm    = haversineKm;
window.findCapital    = findCapital;
