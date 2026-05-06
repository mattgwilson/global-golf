// ── State ──────────────────────────────────────────────────────────────────────

let _currentUser = null;

function currentUser() { return _currentUser; }
window.currentUser = currentUser;

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function friendlyError(code) {
  const map = {
    'auth/user-not-found':        'No account found with that email.',
    'auth/wrong-password':        'Incorrect password.',
    'auth/invalid-credential':    'Incorrect email or password.',
    'auth/email-already-in-use':  'An account already exists with that email.',
    'auth/invalid-email':         'Invalid email address.',
    'auth/weak-password':         'Password must be at least 6 characters.',
    'auth/too-many-requests':     'Too many attempts — try again later.',
    'auth/popup-closed-by-user':  '',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

function showErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}

function clearErrors() {
  document.querySelectorAll('.auth-error').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });
}

// ── Auth UI ────────────────────────────────────────────────────────────────────

function updateHeaderBtn(user) {
  const btn = document.getElementById('btn-user');
  if (!btn) return;
  if (user) {
    btn.textContent = initials(user.displayName || user.email);
    btn.classList.add('signed-in');
    btn.title = user.displayName || user.email;
  } else {
    btn.textContent = 'Sign In';
    btn.classList.remove('signed-in');
    btn.title = '';
  }
}

function openAuthModal(tab = 'signin') {
  switchTab(tab);
  clearErrors();
  document.getElementById('auth-modal').style.display = 'flex';
}
window.openAuthModal = openAuthModal;

function closeAuthModal() {
  document.getElementById('auth-modal').style.display = 'none';
  clearErrors();
}

function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.auth-panel').forEach(p =>
    p.classList.toggle('active', p.id === `tab-${tab}`));
  clearErrors();
}

// ── Sign-in actions ────────────────────────────────────────────────────────────

async function signInWithGoogle() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result   = await auth.signInWithPopup(provider);
    await ensureUserDoc(result.user);
    closeAuthModal();
  } catch (err) {
    const msg = friendlyError(err.code);
    if (msg) showErr('signin-error', msg);
  }
}

async function signInWithEmail() {
  const email    = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  if (!email || !password) return showErr('signin-error', 'Please fill in all fields.');
  try {
    await auth.signInWithEmailAndPassword(email, password);
    closeAuthModal();
  } catch (err) {
    showErr('signin-error', friendlyError(err.code));
  }
}

async function signUp() {
  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!name || !email || !password) return showErr('signup-error', 'Please fill in all fields.');
  if (password.length < 6)          return showErr('signup-error', 'Password must be at least 6 characters.');
  try {
    const result = await auth.createUserWithEmailAndPassword(email, password);
    await result.user.updateProfile({ displayName: name });
    await db.collection('users').doc(result.user.uid).set({
      displayName: name,
      email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    closeAuthModal();
  } catch (err) {
    showErr('signup-error', friendlyError(err.code));
  }
}

async function sendPasswordReset() {
  const email = document.getElementById('signin-email').value.trim();
  if (!email) return showErr('signin-error', 'Enter your email address above first.');
  try {
    await auth.sendPasswordResetEmail(email);
    showErr('signin-error', '✓ Reset email sent — check your inbox.');
  } catch (err) {
    showErr('signin-error', friendlyError(err.code));
  }
}

async function signOut() {
  await auth.signOut();
  closeStatsModal();
}

async function ensureUserDoc(user) {
  const ref  = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      displayName: user.displayName || '',
      email:       user.email || '',
      createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
}

// ── Stats modal ────────────────────────────────────────────────────────────────

async function openStatsModal() {
  document.getElementById('stats-modal').style.display = 'flex';
  document.getElementById('stats-display-name').textContent =
    _currentUser.displayName || _currentUser.email;
  document.getElementById('stats-avatar').textContent =
    initials(_currentUser.displayName || _currentUser.email);

  document.getElementById('recent-results').innerHTML =
    '<div class="empty-state" style="padding:16px">Loading…</div>';

  const stats = await loadUserStats(_currentUser.uid);
  if (!stats) return;

  document.getElementById('stat-world-streak').textContent = stats.worldStreak;
  document.getElementById('stat-us-streak').textContent    = stats.usStreak;
  document.getElementById('stat-world-best').textContent   = stats.worldBestStreak || '—';
  document.getElementById('stat-us-best').textContent      = stats.usBestStreak    || '—';
  document.getElementById('stat-games').textContent        = stats.gamesPlayed;

  const container = document.getElementById('recent-results');
  if (!stats.recentResults.length) {
    container.innerHTML = '<div class="empty-state" style="padding:16px">No daily challenges completed yet.</div>';
    return;
  }
  container.innerHTML = stats.recentResults.map(r => {
    const rel   = r.score;
    const relStr = rel > 0 ? `+${rel}` : `${rel}`;
    const medal = rel <= -2 ? '🦅' : rel === -1 ? '🐦' : rel === 0 ? '⛳' : rel <= 2 ? '😅' : '😬';
    const flag  = r.mode === 'daily' ? '🌍' : '🇺🇸';
    return `
      <div class="recent-row">
        <span class="recent-flag">${flag}</span>
        <span class="recent-date">${r.date || r.id.slice(0, 10)}</span>
        <span class="recent-route">${r.startCity} → ${r.targetCity}</span>
        <span class="recent-score">${medal} ${relStr}</span>
      </div>`;
  }).join('');
}

function closeStatsModal() {
  document.getElementById('stats-modal').style.display = 'none';
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Auth state listener
  auth.onAuthStateChanged(user => {
    _currentUser = user;
    updateHeaderBtn(user);
    // Hide sign-in prompt on finish screen if user just logged in
    const prompt = document.getElementById('finish-signin-prompt');
    if (prompt) prompt.style.display = 'none';
  });

  // Header user button
  document.getElementById('btn-user').addEventListener('click', () => {
    if (_currentUser) openStatsModal();
    else openAuthModal();
  });

  // Auth modal close
  document.getElementById('auth-close').addEventListener('click', closeAuthModal);
  document.getElementById('auth-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAuthModal();
  });

  // Tabs
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // Google buttons
  document.getElementById('btn-google-signin').addEventListener('click', signInWithGoogle);
  document.getElementById('btn-google-signup').addEventListener('click', signInWithGoogle);

  // Email sign-in
  document.getElementById('btn-signin').addEventListener('click', signInWithEmail);
  document.getElementById('signin-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') signInWithEmail();
  });

  // Sign-up
  document.getElementById('btn-signup').addEventListener('click', signUp);
  document.getElementById('signup-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') signUp();
  });

  // Forgot password
  document.getElementById('btn-forgot').addEventListener('click', sendPasswordReset);

  // Stats modal close
  document.getElementById('stats-close').addEventListener('click', closeStatsModal);
  document.getElementById('stats-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeStatsModal();
  });

  // Sign out
  document.getElementById('btn-signout').addEventListener('click', signOut);
});
