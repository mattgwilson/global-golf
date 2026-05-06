// ── Date helpers ───────────────────────────────────────────────────────────────

function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Save a daily result and update streak ──────────────────────────────────────

async function saveDailyResult(uid, mode, result) {
  const today    = dateStr(0);
  const resultId = `${today}__${mode}`;
  const userRef  = db.collection('users').doc(uid);
  const resultRef = userRef.collection('dailyResults').doc(resultId);

  // Don't double-count if already saved today
  const existing = await resultRef.get();
  if (existing.exists) return null;

  await resultRef.set({
    mode,
    strokes:    result.strokes,
    penalties:  result.penalties,
    par:        result.par,
    score:      result.score,
    startCity:  result.startCity,
    targetCity: result.targetCity,
    date:       today,
    completedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  // Streak fields keyed by mode
  const streakKey = mode === 'daily' ? 'worldStreak' : 'usStreak';
  const bestKey   = mode === 'daily' ? 'worldBestStreak' : 'usBestStreak';
  const lastKey   = mode === 'daily' ? 'worldLastDate'   : 'usLastDate';

  const snap = await userRef.get();
  const data = snap.exists ? snap.data() : {};

  const lastDate = data[lastKey] || '';
  let   streak   = data[streakKey] || 0;

  if (lastDate === dateStr(-1)) {
    streak++;                 // consecutive day
  } else if (lastDate === today) {
    return null;              // already counted (guard)
  } else {
    streak = 1;               // streak reset
  }

  const bestStreak = Math.max(data[bestKey] || 0, streak);

  await userRef.set({
    [streakKey]:             streak,
    [bestKey]:               bestStreak,
    [lastKey]:               today,
    gamesPlayed:             (data.gamesPlayed || 0) + 1,
  }, { merge: true });

  return { streak, bestStreak };
}

// ── Load stats for the profile panel ──────────────────────────────────────────

async function loadUserStats(uid) {
  const userRef = db.collection('users').doc(uid);
  const snap    = await userRef.get();
  if (!snap.exists) return null;
  const data = snap.data();

  const resultsSnap = await userRef
    .collection('dailyResults')
    .orderBy(firebase.firestore.FieldPath.documentId(), 'desc')
    .limit(14)
    .get();

  return {
    worldStreak:     data.worldStreak     || 0,
    worldBestStreak: data.worldBestStreak || 0,
    usStreak:        data.usStreak        || 0,
    usBestStreak:    data.usBestStreak    || 0,
    gamesPlayed:     data.gamesPlayed     || 0,
    recentResults:   resultsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

window.saveDailyResult = saveDailyResult;
window.loadUserStats   = loadUserStats;
