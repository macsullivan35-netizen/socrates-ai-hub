// Shared auth modal + nav state — imported by every page
import { supabase, getUser, getProfile, signUp, signIn, signOut } from './supabase-client.js';

// ── INJECT AUTH MODAL HTML ──
const modalHTML = `
<div id="authModal" style="display:none;position:fixed;inset:0;background:rgba(10,10,20,.6);z-index:9999;align-items:center;justify-content:center;padding:24px">
  <div style="background:#fff;border-radius:20px;padding:40px;max-width:420px;width:100%;position:relative;box-shadow:0 24px 80px rgba(0,0,0,.18)">
    <button onclick="closeAuthModal()" style="position:absolute;top:14px;right:14px;background:#f2f0ea;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:16px">✕</button>
    
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:40px;margin-bottom:10px">🏛️</div>
      <h2 id="authTitle" style="font-family:'Playfair Display',serif;font-size:26px;font-weight:900;color:#1a1a2e">Join Socrates</h2>
      <p id="authSub" style="color:#5e5e76;font-size:14px;margin-top:6px">Create your free account</p>
    </div>

    <div id="authError" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;margin-bottom:16px;font-size:13px;color:#dc2626"></div>

    <input id="authEmail" type="email" placeholder="Email address" style="width:100%;padding:13px 16px;border:1px solid rgba(20,20,40,.12);border-radius:11px;font-size:15px;margin-bottom:12px;outline:none;font-family:'Inter',sans-serif"/>
    <input id="authPassword" type="password" placeholder="Password (min 6 characters)" style="width:100%;padding:13px 16px;border:1px solid rgba(20,20,40,.12);border-radius:11px;font-size:15px;margin-bottom:20px;outline:none;font-family:'Inter',sans-serif"/>

    <button id="authSubmitBtn" onclick="handleAuthSubmit()" style="width:100%;padding:14px;background:linear-gradient(135deg,#9a6e0c,#a8722a);color:#fff;border:none;border-radius:11px;font-size:15px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif">
      Create Account
    </button>

    <p style="text-align:center;margin-top:16px;font-size:13px;color:#5e5e76">
      <span id="authToggleText">Already have an account?</span>
      <a href="#" id="authToggleLink" onclick="toggleAuthMode(event)" style="color:#9a6e0c;font-weight:700;text-decoration:none"> Sign in</a>
    </p>
  </div>
</div>

<div id="userMenu" style="display:none;position:absolute;top:60px;right:60px;background:#fff;border:1px solid rgba(20,20,40,.09);border-radius:14px;padding:8px;box-shadow:0 8px 32px rgba(0,0,0,.12);z-index:200;min-width:180px">
  <div id="userMenuName" style="padding:10px 14px;font-size:13px;font-weight:600;color:#1a1a2e;border-bottom:1px solid rgba(20,20,40,.06);margin-bottom:4px"></div>
  <a href="dashboard.html" style="display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:8px;text-decoration:none;color:#1a1a2e;font-size:13px;font-weight:500" onmouseover="this.style.background='#f2f0ea'" onmouseout="this.style.background=''">📊 My Dashboard</a>
  <a href="publish.html" style="display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:8px;text-decoration:none;color:#1a1a2e;font-size:13px;font-weight:500" onmouseover="this.style.background='#f2f0ea'" onmouseout="this.style.background=''">🛠️ Build a Tool</a>
  <a href="settings.html" style="display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:8px;text-decoration:none;color:#1a1a2e;font-size:13px;font-weight:500" onmouseover="this.style.background='#f2f0ea'" onmouseout="this.style.background=''">⚙️ Settings</a>
  <hr style="border:none;border-top:1px solid rgba(20,20,40,.06);margin:4px 0"/>
  <button onclick="handleSignOut()" style="width:100%;text-align:left;display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:8px;background:none;border:none;cursor:pointer;color:#dc2626;font-size:13px;font-weight:500;font-family:'Inter',sans-serif" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background=''">🚪 Sign Out</button>
</div>
`;

document.addEventListener('DOMContentLoaded', () => {
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  initAuth();
});

let authMode = 'signup'; // 'signup' or 'login'

// ── INIT: check if logged in and update nav ──
async function initAuth() {
  const user = await getUser();
  updateNav(user);

  // Listen for auth state changes
  supabase.auth.onAuthStateChange((_event, session) => {
    updateNav(session?.user ?? null);
  });
}

function updateNav(user) {
  const ctaArea = document.querySelector('.nav-cta');
  if (!ctaArea) return;

  if (user) {
    getProfile(user.id).then(profile => {
      const name = profile?.display_name || profile?.username || user.email.split('@')[0];
      ctaArea.innerHTML = `
        <button onclick="toggleUserMenu()" style="display:flex;align-items:center;gap:8px;background:#f2f0ea;border:1px solid rgba(20,20,40,.09);border-radius:10px;padding:8px 16px;cursor:pointer;font-size:14px;font-weight:600;color:#1a1a2e;font-family:'Inter',sans-serif">
          <span style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#9a6e0c,#7c3aed);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">${name[0].toUpperCase()}</span>
          ${name} ▾
        </button>
      `;
      document.getElementById('userMenuName').textContent = name;
    });
  } else {
    ctaArea.innerHTML = `
      <button onclick="openAuthModal('login')" style="padding:10px 22px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid rgba(20,20,40,.09);background:transparent;color:#1a1a2e;font-family:'Inter',sans-serif">Sign In</button>
      <button onclick="openAuthModal('signup')" style="padding:10px 22px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;background:linear-gradient(135deg,#9a6e0c,#a8722a);color:#fff;font-family:'Inter',sans-serif">Sign Up Free</button>
    `;
  }
}

// ── MODAL CONTROLS ──
window.openAuthModal = function(mode = 'signup') {
  authMode = mode;
  const modal = document.getElementById('authModal');
  modal.style.display = 'flex';
  document.getElementById('authTitle').textContent = mode === 'signup' ? 'Join Socrates' : 'Welcome back';
  document.getElementById('authSub').textContent = mode === 'signup' ? 'Create your free account' : 'Sign in to your account';
  document.getElementById('authSubmitBtn').textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
  document.getElementById('authToggleText').textContent = mode === 'signup' ? 'Already have an account?' : "Don't have an account?";
  document.getElementById('authToggleLink').textContent = mode === 'signup' ? ' Sign in' : ' Sign up free';
  document.getElementById('authError').style.display = 'none';
  document.body.style.overflow = 'hidden';
};

window.closeAuthModal = function() {
  document.getElementById('authModal').style.display = 'none';
  document.body.style.overflow = '';
};

window.toggleAuthMode = function(e) {
  e.preventDefault();
  openAuthModal(authMode === 'signup' ? 'login' : 'signup');
};

window.toggleUserMenu = function() {
  const menu = document.getElementById('userMenu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
};

document.addEventListener('click', e => {
  const menu = document.getElementById('userMenu');
  if (menu && !e.target.closest('#userMenu') && !e.target.closest('[onclick="toggleUserMenu()"]')) {
    menu.style.display = 'none';
  }
});

// ── AUTH ACTIONS ──
window.handleAuthSubmit = async function() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const btn = document.getElementById('authSubmitBtn');
  const errEl = document.getElementById('authError');

  if (!email || !password) {
    showAuthError('Please enter your email and password.');
    return;
  }

  btn.textContent = 'Please wait…';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    let result;
    if (authMode === 'signup') {
      result = await signUp(email, password);
      if (result.error) throw result.error;
      closeAuthModal();
      showToast('✅ Account created! Check your email to confirm, then sign in.');
    } else {
      result = await signIn(email, password);
      if (result.error) throw result.error;
      closeAuthModal();
      showToast('✅ Welcome back!');
    }
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.textContent = authMode === 'signup' ? 'Create Account' : 'Sign In';
    btn.disabled = false;
  }
};

window.handleSignOut = async function() {
  await signOut();
  document.getElementById('userMenu').style.display = 'none';
  showToast('Signed out successfully.');
};

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.style.display = 'block';
}

// ── TOAST NOTIFICATION ──
window.showToast = function(msg, type = 'success') {
  const existing = document.getElementById('socrToast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'socrToast';
  toast.textContent = msg;
  toast.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:${type === 'error' ? '#dc2626' : '#1a1a2e'};color:#fff;padding:13px 24px;border-radius:12px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,.2);font-family:'Inter',sans-serif;max-width:90vw;text-align:center`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
};

export { initAuth, getUser };
