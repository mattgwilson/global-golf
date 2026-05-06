let globe;
let game = new GameState();
let selectedClub = null;
let aiThinking   = false;
let useImperial  = localStorage.getItem('golf-unit') === 'mi';

function fmtDist(km) {
  if (useImperial) return `${Math.round(km * 0.621371).toLocaleString()} mi`;
  return `${km.toLocaleString()} km`;
}

function updateDistanceUnits() {
  document.querySelectorAll('.dist-val[data-km]').forEach(span => {
    span.textContent = fmtDist(+span.dataset.km);
  });
  buildClubButtons();
  updateScaleBar();
}

function makeSolidTexture(color) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 2, 2);
  return c.toDataURL();
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

// ── Scale bar ──────────────────────────────────────────────────────────────────

// Returns the point distKm away from (lat,lng) on the given bearing (degrees)
function destPoint(lat, lng, bearingDeg, distKm) {
  const R    = 6371;
  const d    = distKm / R;
  const brng = bearingDeg * Math.PI / 180;
  const φ1   = lat * Math.PI / 180;
  const λ1   = lng * Math.PI / 180;
  const φ2   = Math.asin(
    Math.sin(φ1) * Math.cos(d) +
    Math.cos(φ1) * Math.sin(d) * Math.cos(brng)
  );
  const λ2   = λ1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(φ1),
    Math.cos(d) - Math.sin(φ1) * Math.sin(φ2)
  );
  return { lat: φ2 * 180 / Math.PI, lng: ((λ2 * 180 / Math.PI) + 540) % 360 - 180 };
}

function updateScaleBar() {
  if (!globe) return;
  try {
    // Show a round number in the active unit: 1,000 km or 1,000 mi (≈1,609 km)
    const scaleKm = useImperial ? 1609.34 : 1000;
    const pov = globe.pointOfView();
    const p1  = globe.getScreenCoords(pov.lat, pov.lng, 0);
    const pt2 = destPoint(pov.lat, pov.lng, 90, scaleKm);
    const p2  = globe.getScreenCoords(pt2.lat, pt2.lng, 0);
    if (!p1 || !p2) return;

    const px    = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const inner = document.getElementById('scale-bar-inner');
    const bar   = document.getElementById('scale-bar');
    const label = document.getElementById('scale-bar-text');
    if (!inner || !bar) return;

    if (px >= 4 && px <= 500) {
      inner.style.width = `${Math.round(px)}px`;
      bar.style.opacity = '1';
      if (label) label.textContent = useImperial ? '1,000 mi' : '1,000 km';
    } else {
      bar.style.opacity = '0';
    }
  } catch (_) { /* globe not ready */ }
}

// ── Globe setup ────────────────────────────────────────────────────────────────

function initGlobe() {
  const container = document.getElementById('globe-container');

  globe = Globe({ animateIn: false })
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .backgroundImageUrl(makeSolidTexture('#0a0e1a'))
    .showAtmosphere(true)
    .atmosphereColor('#00d4ff')
    .atmosphereAltitude(0.3)
    .width(container.clientWidth)
    .height(container.clientHeight)
    (container);

  globe.controls().autoRotate      = true;
  globe.controls().autoRotateSpeed = 0.4;
  globe.controls().enableZoom      = true;

  fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/country-borders/countries.geojson')
    .then(r => r.json())
    .then(({ features }) => {
      globe
        .polygonsData(features)
        .polygonCapColor(() => 'rgba(0,212,255,0.08)')
        .polygonSideColor(() => 'rgba(0,212,255,0.35)')
        .polygonStrokeColor(() => '#00d4ff')
        .polygonAltitude(0.01);
    });

  const ro = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect;
    if (width > 0 && height > 0) globe.width(width).height(height);
  });
  ro.observe(container);
}

function updateGlobe() {
  if (!game.players.length) return;

  const points = [];
  const rings  = [];
  const arcs   = [];

  // All shot arcs across all players (colour by player)
  game.players.forEach(player => {
    player.shots.forEach(shot => {
      const arcColor = shot.penalty ? '#ff4444' : player.color;
      arcs.push({
        startLat: shot.from.lat, startLng: shot.from.lng,
        endLat:   shot.to.lat,   endLng:   shot.to.lng,
        color: arcColor, stroke: 2,
      });
    });
  });

  // Target — always red
  if (game.target) {
    points.push({ lat: game.target.lat, lng: game.target.lng, color: '#ff4444', radius: 0.55 });
    rings.push({ lat: game.target.lat, lng: game.target.lng, color: t => `rgba(255,68,68,${1-t})`, maxR: 4, speed: 1.2, period: 900 });
  }

  // All players' current positions (larger dot for active player)
  game.players.forEach((player, idx) => {
    if (!player.current || player.finished) return;
    const isActive = idx === game.activePlayerIdx;
    const rgb = hexToRgb(player.color);
    points.push({ lat: player.current.lat, lng: player.current.lng, color: player.color, radius: isActive ? 0.65 : 0.45 });
    rings.push({ lat: player.current.lat, lng: player.current.lng, color: t => `rgba(${rgb},${1-t})`, maxR: isActive ? 4 : 2.5, speed: 1.2, period: 900 });
  });

  globe
    .pointsData(points)
    .pointLat(d => d.lat)
    .pointLng(d => d.lng)
    .pointColor(d => d.color)
    .pointRadius(d => d.radius)
    .pointAltitude(0.01)
    .labelsData([])
    .ringsData(rings)
    .ringLat(d => d.lat)
    .ringLng(d => d.lng)
    .ringColor(d => d.color)
    .ringMaxRadius(d => d.maxR)
    .ringPropagationSpeed(d => d.speed)
    .ringRepeatPeriod(d => d.period)
    .arcsData(arcs)
    .arcStartLat(d => d.startLat)
    .arcStartLng(d => d.startLng)
    .arcEndLat(d => d.endLat)
    .arcEndLng(d => d.endLng)
    .arcColor(d => d.color)
    .arcStroke(d => d.stroke)
    .arcDashLength(0.5)
    .arcDashGap(0.2)
    .arcDashAnimateTime(1500)
    .arcAltitudeAutoScale(0.4);
}

function flyTo(capital, altitudeFactor = 1.8) {
  globe.controls().autoRotate = false;
  globe.pointOfView({ lat: capital.lat, lng: capital.lng, altitude: altitudeFactor }, 1200);
  setTimeout(() => { globe.controls().autoRotate = true; }, 2000);
}

// ── UI helpers ─────────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function setMessage(msg, type = 'info') {
  const div = el('message');
  div.textContent = msg;
  div.className = `message ${type}`;
  div.style.display = msg ? 'block' : 'none';
}

function buildClubButtons() {
  const container = el('clubs');
  container.innerHTML = '';
  (game.activeClubs || CLUBS).forEach(club => {
    const btn = document.createElement('button');
    btn.className = 'club-btn';
    btn.dataset.club = club.name;
    const rangeLabel = useImperial
      ? `${Math.round(club.ideal * 0.621371).toLocaleString()} mi`
      : club.label;
    btn.innerHTML = `<span class="club-name">${club.name}</span><span class="club-range">${rangeLabel}</span>`;
    btn.style.setProperty('--club-color', club.color);
    btn.addEventListener('click', () => selectClub(club.name));
    container.appendChild(btn);
  });
}

function selectClub(name) {
  selectedClub = name;
  game.selectedClub = name;
  document.querySelectorAll('.club-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.club === name);
  });
  el('city-input').focus();
}

function updatePlayerIndicator() {
  const indicator = el('player-indicator');
  if (game.isSinglePlayer() || game.players.length <= 1) {
    indicator.style.display = 'none';
    return;
  }
  const p = game.activePlayer;
  indicator.style.display = 'flex';
  indicator.style.setProperty('--pc', p.color);
  el('indicator-name').textContent = p.isAI ? `${p.name} is thinking…` : `${p.name}'s turn`;
  indicator.className = `player-indicator${p.isAI ? ' ai-turn' : ''}`;
}

function updateScoreboard() {
  if (!game.players.length) return;

  // Active player stats for the top row
  const p = game.activePlayer || game.players[0];
  if (p.current) el('current-city').textContent = `${p.current.name}, ${p.current.country}`;
  el('strokes').textContent   = p.strokes;
  el('penalties').textContent = p.penalties;
  el('par').textContent       = game.par;

  const total = p.strokes + p.penalties;
  const relScore = total > 0
    ? (game.score > 0 ? `+${game.score}` : `${game.score}`)
    : '—';
  el('relative-score').textContent = relScore;
  el('score-label').textContent    = game.scoreLabel || '';

  // Multi-player mini-leaderboard
  const panel = el('players-panel');
  if (game.players.length > 1) {
    panel.style.display = 'block';
    panel.innerHTML = game.players.map((player, idx) => {
      const total = player.strokes + player.penalties;
      const isActive = idx === game.activePlayerIdx;
      const statusIcon = player.finished ? '🏁' : isActive ? '▶' : '·';
      return `
        <div class="mini-player${isActive ? ' active' : ''}${player.finished ? ' done' : ''}" style="--pc:${player.color}">
          <span class="mini-icon">${statusIcon}</span>
          <span class="mini-name">${player.name}</span>
          <span class="mini-score">${total > 0 ? total + ' strk' : '—'}</span>
        </div>
      `;
    }).join('');
  } else {
    panel.style.display = 'none';
  }
}

function addShotHistory(shot) {
  const list = el('shot-list');
  const empty = list.querySelector('.empty-state');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = `shot-item${shot.penalty ? ' penalty' : ''}`;
  if (!shot.penalty) item.style.setProperty('--shot-color', shot.playerColor || shot.clubColor);

  const penaltyNote = shot.overshootDest
    ? ` · ⚠ overshot ${shot.overshootDest.name}`
    : shot.penalty ? ` · ⚠ penalty (use ${shot.idealClub})` : '';

  const playerTag = game.players.length > 1
    ? `<span class="shot-player" style="color:${shot.playerColor}">${shot.playerName}</span> ` : '';

  item.innerHTML = `
    <span class="shot-num">${shot.strokeNumber}</span>
    <span class="shot-info">
      ${playerTag}<strong>${shot.from.name}</strong> → <strong>${shot.to.name}</strong>
      <small>${shot.club} · <span class="dist-val" data-km="${shot.distKm}">${fmtDist(shot.distKm)}</span>${penaltyNote}</small>
    </span>
  `;
  list.prepend(item);
}

function buildShotLog(shots, showPlayer) {
  if (!shots.length) return '';
  return `
    <div class="finish-shot-log">
      ${shots.map(shot => {
        const penaltyNote = shot.overshootDest
          ? ` · overshot ${shot.overshootDest.name}`
          : shot.penalty ? ` · used ${shot.idealClub}` : '';
        const playerTag = showPlayer
          ? `<span class="fsl-player" style="color:${shot.playerColor}">${shot.playerName}</span> ` : '';
        return `
          <div class="fsl-row${shot.penalty ? ' fsl-penalty' : ''}" style="--sc:${shot.playerColor || shot.clubColor || '#a78bfa'}">
            <span class="fsl-num">${shot.strokeNumber}</span>
            <span class="fsl-body">
              ${playerTag}<strong>${shot.from.name}</strong> → <strong>${shot.to.name}</strong>
              <small>${shot.club} · <span class="dist-val" data-km="${shot.distKm}">${fmtDist(shot.distKm)}</span>${penaltyNote}${shot.penalty ? ' ⚠' : ''}</small>
            </span>
          </div>`;
      }).join('')}
    </div>`;
}

function showFinishScreen() {
  const overlay = el('finish-overlay');

  if (game.isSinglePlayer()) {
    const scoreDiff = game.score;
    const medal = scoreDiff <= -2 ? '🦅' : scoreDiff === -1 ? '🐦' : scoreDiff === 0 ? '⛳' : scoreDiff <= 2 ? '😅' : '😬';
    el('finish-medal').textContent = medal;
    el('finish-title').textContent = game.scoreLabel || `+${scoreDiff}`;
    el('finish-details').innerHTML = `
      <p>${game.shots[0]?.from.name} → ${game.target.name}</p>
      <p>${game.strokes} stroke${game.strokes !== 1 ? 's' : ''} · Par ${game.par} · ${game.penalties} penalt${game.penalties !== 1 ? 'ies' : 'y'}</p>
      ${buildShotLog(game.shots, false)}
    `;
  } else {
    const board = game.leaderboard();
    const winner = board[0];
    el('finish-medal').textContent = '🏆';
    el('finish-title').textContent = `${winner.name} Wins!`;

    const rows = board.map((p, i) => {
      const total = p.strokes + p.penalties;
      const rel   = total - game.par;
      const relStr = rel > 0 ? `+${rel}` : `${rel}`;
      const medals = ['🥇','🥈','🥉','4️⃣'];
      return `
        <div class="finish-row" style="--pc:${p.color}">
          <span class="finish-rank-medal">${medals[i] || (i+1)}</span>
          <span class="finish-pname">${p.name}</span>
          <span class="finish-pscore">${total} (${relStr})</span>
        </div>`;
    }).join('');

    // Interleave all shots chronologically by stroke index
    const allShots = game.players.flatMap(p => p.shots).sort((a, b) => {
      const ai = game.players.indexOf(game.players.find(p => p.shots.includes(a)));
      const bi = game.players.indexOf(game.players.find(p => p.shots.includes(b)));
      return a.strokeNumber !== b.strokeNumber ? a.strokeNumber - b.strokeNumber : ai - bi;
    });

    el('finish-details').innerHTML = `
      <p>${game.players[0].shots[0]?.from.name} → ${game.target.name} · Par ${game.par}</p>
      <div class="finish-leaderboard">${rows}</div>
      ${buildShotLog(allShots, true)}
    `;
  }

  overlay.style.display = 'flex';
}

// ── Game start & setup ─────────────────────────────────────────────────────────

function showSetup(panel) {
  ['setup-cpu','setup-1v1','setup-battle'].forEach(id => {
    el(id).style.display = id === panel ? 'flex' : 'none';
  });
}

let lastGameOptions = {};

function startGame(mode, options = {}) {
  lastGameOptions = options;
  game.start(mode, options);
  aiThinking  = false;
  selectedClub = null;
  el('finish-overlay').style.display = 'none';
  el('shot-list').innerHTML = '<div class="empty-state">No shots yet</div>';
  document.querySelectorAll('.club-btn').forEach(b => b.classList.remove('selected'));
  el('city-input').value = '';
  setMessage('');

  const isUSMode = mode === 'us-daily' || mode === 'us-random';
  el('city-input').placeholder = isUSMode ? 'Type a state capital...' : 'Type a capital city...';

  buildClubButtons();
  updatePlayerIndicator();
  updateScoreboard();
  updateGlobe();
  flyTo(game.current, isUSMode ? 1.4 : 2.0);

  el('game-panel').style.display  = 'flex';
  el('start-panel').style.display = 'none';
  el('city-input').focus();

  // If the very first active player is an AI (shouldn't happen but safety)
  if (game.activePlayer.isAI) {
    scheduleAI();
  }
}

function shoot() {
  if (aiThinking) return;

  const input = el('city-input').value.trim();
  if (!input) { setMessage('Type a destination city.', 'warn'); return; }

  const result = game.shoot(selectedClub, input);

  if (result.error) {
    setMessage(result.error, 'error');
    return;
  }

  const { shot } = result;
  el('city-input').value = '';
  setMessage('');
  document.querySelectorAll('.club-btn').forEach(b => b.classList.remove('selected'));
  selectedClub = null;

  updateGlobe();
  flyTo(shot.to, 1.8);
  updateScoreboard();
  addShotHistory(shot);

  if (shot.overshootDest) {
    setMessage(`Overshot! Aimed for ${shot.overshootDest.name} but landed in ${shot.to.name} — nearest capital on the flight path at ${fmtDist(shot.distKm)}. +1 penalty.`, 'warn');
  } else if (shot.penalty) {
    setMessage(`Penalty stroke! ${fmtDist(shot.distKm)} — that called for a ${shot.idealClub}.`, 'warn');
  } else {
    setMessage(`Nice shot! ${fmtDist(shot.distKm)} — ${shot.club} was the right call.`, 'good');
  }

  if (result.playerFinished && !result.finished) {
    setMessage(`${shot.playerName} reached ${game.target.name}! Others still playing…`, 'good');
  }

  if (result.finished) {
    setTimeout(showFinishScreen, 800);
    return;
  }

  updatePlayerIndicator();

  // If next player is AI, schedule it
  if (game.activePlayer.isAI) {
    scheduleAI();
  }
}

// ── AI turn ────────────────────────────────────────────────────────────────────

function scheduleAI() {
  aiThinking = true;
  updatePlayerIndicator();
  disableInput(true);
  setTimeout(runAITurn, 1600);
}

function runAITurn() {
  if (!game.activePlayer || !game.activePlayer.isAI) {
    aiThinking = false;
    disableInput(false);
    return;
  }

  const result = game.shootAI();
  if (!result || result.error) {
    aiThinking = false;
    disableInput(false);
    updatePlayerIndicator();
    return;
  }

  const { shot } = result;
  updateGlobe();
  flyTo(shot.to, 1.8);
  updateScoreboard();
  addShotHistory(shot);

  if (shot.penalty) {
    setMessage(`${shot.playerName}: Penalty! ${fmtDist(shot.distKm)} needed a ${shot.idealClub}.`, 'warn');
  } else {
    setMessage(`${shot.playerName}: ${fmtDist(shot.distKm)} with ${shot.club}.`, 'info');
  }

  if (result.playerFinished && !result.finished) {
    setMessage(`${shot.playerName} reached ${game.target.name}!`, 'good');
  }

  if (result.finished) {
    aiThinking = false;
    disableInput(false);
    setTimeout(showFinishScreen, 800);
    return;
  }

  updatePlayerIndicator();

  if (game.activePlayer.isAI) {
    // AI plays multiple consecutive shots (should only happen in edge cases)
    setTimeout(runAITurn, 1600);
  } else {
    aiThinking = false;
    disableInput(false);
  }
}

function disableInput(disabled) {
  el('city-input').disabled = disabled;
  el('btn-shoot').disabled  = disabled;
  document.querySelectorAll('.club-btn').forEach(b => b.disabled = disabled);
}

// ── Event wiring ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => {
    initGlobe();
    globe.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 0);

    // Wire scale bar updates to camera movement (must be after initGlobe)
    globe.controls().addEventListener('change', updateScaleBar);
    setTimeout(updateScaleBar, 200); // initial draw after globe settles
  });

  // ── Unit toggle ──
  function applyUnitToggle() {
    el('btn-km').classList.toggle('active', !useImperial);
    el('btn-mi').classList.toggle('active',  useImperial);
    updateDistanceUnits();
  }
  el('btn-km').addEventListener('click', () => { useImperial = false; localStorage.setItem('golf-unit','km'); applyUnitToggle(); });
  el('btn-mi').addEventListener('click', () => { useImperial = true;  localStorage.setItem('golf-unit','mi'); applyUnitToggle(); });
  // Apply saved preference immediately
  el('btn-km').classList.toggle('active', !useImperial);
  el('btn-mi').classList.toggle('active',  useImperial);

  // ── Single-player ──
  el('btn-daily').addEventListener('click',  () => startGame('daily'));
  el('btn-random').addEventListener('click', () => startGame('random'));

  // ── US State Capitals ──
  el('btn-us-daily').addEventListener('click',  () => startGame('us-daily'));
  el('btn-us-random').addEventListener('click', () => startGame('us-random'));

  // ── vs CPU setup ──
  el('btn-vs-cpu').addEventListener('click', () => showSetup('setup-cpu'));

  let selectedDiff = 'medium';
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDiff = btn.dataset.diff;
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('selected', b === btn));
    });
  });
  // Pre-select medium
  document.querySelector('.diff-btn[data-diff="medium"]')?.classList.add('selected');

  el('btn-start-cpu').addEventListener('click', () => {
    startGame('vs-cpu', { difficulty: selectedDiff, playerName: 'You' });
  });

  // ── 1v1 setup ──
  el('btn-1v1').addEventListener('click', () => showSetup('setup-1v1'));
  el('btn-start-1v1').addEventListener('click', () => {
    const names = [
      el('p1-name').value.trim() || 'Player 1',
      el('p2-name').value.trim() || 'Player 2',
    ];
    startGame('1v1', { names });
  });

  // ── Battle Royale setup ──
  el('btn-battle').addEventListener('click', () => {
    showSetup('setup-battle');
    updateBattleNames(2);
  });

  let battleCount = 2;
  document.querySelectorAll('.count-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      battleCount = parseInt(btn.dataset.count, 10);
      document.querySelectorAll('.count-btn').forEach(b => b.classList.toggle('selected', b === btn));
      updateBattleNames(battleCount);
    });
  });

  el('btn-start-battle').addEventListener('click', () => {
    const names = Array.from(el('battle-names').querySelectorAll('input'))
      .map((inp, i) => inp.value.trim() || `Player ${i + 1}`);
    startGame('battle', { names });
  });

  // ── In-game ──
  el('btn-shoot').addEventListener('click', shoot);
  el('city-input').addEventListener('keydown', e => { if (e.key === 'Enter') shoot(); });

  el('btn-new-game').addEventListener('click', resetToMenu);
  el('btn-play-again').addEventListener('click', () => {
    el('finish-overlay').style.display = 'none';
    startGame(game.mode, lastGameOptions);
  });
  el('btn-new-from-finish').addEventListener('click', resetToMenu);
});

function resetToMenu() {
  el('start-panel').style.display = 'flex';
  el('game-panel').style.display  = 'none';
  el('finish-overlay').style.display = 'none';
  ['setup-cpu','setup-1v1','setup-battle'].forEach(id => el(id).style.display = 'none');
  game.reset();
  aiThinking = false;
  globe.pointsData([]).labelsData([]).arcsData([]).ringsData([]);
  globe.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 800);
}

function updateBattleNames(count) {
  const container = el('battle-names');
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'battle-name-input';
    inp.placeholder = `Player ${i + 1}`;
    inp.value = `Player ${i + 1}`;
    inp.style.setProperty('--pc', PLAYER_COLORS[i]);
    container.appendChild(inp);
  }
}
