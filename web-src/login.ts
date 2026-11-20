import { ApiError, getJson, postJson } from './shared/api.js';
import { busy, el } from './shared/dom.js';
import { initMotivationQuotes } from './shared/auth-art.js';
import { wirePasswordToggles } from './shared/password.js';
import { initPwa } from './shared/pwa.js';

initPwa();

interface Me {
  mustChangePassword: boolean;
  home: string;
}
interface LoginResult {
  mustChangePassword: boolean;
  redirect: string;
}
interface Redirect {
  redirect: string;
}

wirePasswordToggles();

initMotivationQuotes();

// Dynamic Day Name matching Pastel's "Happy [Day]!"
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const dayEl = document.getElementById('day-name');
if (dayEl) {
  dayEl.textContent = days[new Date().getDay()] ?? 'Today';
}

// Shimmer runs on first visit only; subsequent visits skip to resting state
try {
  const titleEl = document.querySelector('.welcome-title');
  if (titleEl) {
    if (sessionStorage.getItem('fynix_shimmer_seen')) {
      titleEl.classList.add('shimmer-done');
    } else {
      sessionStorage.setItem('fynix_shimmer_seen', '1');
    }
  }
} catch {
  // Ignore in sandboxed / private environments
}

const signin = el<HTMLFormElement>('signin');
const change = el<HTMLFormElement>('change');

function showChange(): void {
  signin.hidden = true;
  change.hidden = false;
  el('next').focus();
}

const forgotForm = el<HTMLFormElement>('forgotform');
const forgotLabel = 'Send reset link';

function showForgot(): void {
  signin.hidden = true;
  forgotForm.hidden = false;
  el('err3').textContent = '';
  el('forgot-done').hidden = true;
  busy(el<HTMLButtonElement>('go3'), false, forgotLabel);
  const field = el<HTMLInputElement>('fe');
  field.value = el<HTMLInputElement>('email').value.trim();
  field.focus();
}

function showSignin(): void {
  forgotForm.hidden = true;
  signin.hidden = false;
  el('email').focus();
}

el('forgot').addEventListener('click', showForgot);
el('back-signin').addEventListener('click', showSignin);

interface ForgotResult {
  ok: boolean;
  emailed: boolean;
}

forgotForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const error = el('err3');
  const done = el('forgot-done');
  const button = el<HTMLButtonElement>('go3');
  const email = el<HTMLInputElement>('fe').value.trim();
  error.textContent = '';
  done.hidden = true;
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    error.textContent = 'Enter a valid email address.';
    return;
  }
  busy(button, true, forgotLabel);
  postJson<ForgotResult>('/api/auth/forgot', { email })
    .then((result) => {
      done.textContent = result.emailed
        ? `If there is an account for ${email}, we have emailed it a link to choose a new password. It works once and expires in 7 days. Check your spam folder too.`
        : 'Email is not set up yet, so we cannot send a link. Ask your superadmin to send you a reset link.';
      done.hidden = false;
      busy(button, false, result.emailed ? 'Send again' : forgotLabel);
    })
    .catch((failure: unknown) => {
      busy(button, false, forgotLabel);
      error.textContent = failure instanceof ApiError ? failure.message : 'Something went wrong. Please try again.';
    });
});

// Already signed in: go straight to the right screen (or to the password change if one is pending).
getJson<Me>('/api/auth/me')
  .then((me) => {
    if (me.mustChangePassword) showChange();
    else window.location.replace(me.home);
  })
  .catch(() => undefined);

signin.addEventListener('submit', (event) => {
  event.preventDefault();
  const error = el('err1');
  const button = el<HTMLButtonElement>('go1');
  const email = el<HTMLInputElement>('email').value.trim();
  const password = el<HTMLInputElement>('password').value;
  error.textContent = '';
  if (!email || !password) {
    error.textContent = 'Enter your email and password.';
    return;
  }
  busy(button, true, 'Sign in');
  postJson<LoginResult>('/api/auth/login', { email, password, remember: el<HTMLInputElement>('remember').checked })
    .then((result) => {
      if (result.mustChangePassword) {
        busy(button, false, 'Sign in');
        el<HTMLInputElement>('cur').value = password;
        showChange();
        return;
      }
      window.location.replace(result.redirect);
    })
    .catch((failure: unknown) => {
      busy(button, false, 'Sign in');
      error.textContent = failure instanceof ApiError ? failure.message : 'Something went wrong. Please try again.';
    });
});

change.addEventListener('submit', (event) => {
  event.preventDefault();
  const error = el('err2');
  const button = el<HTMLButtonElement>('go2');
  const current = el<HTMLInputElement>('cur').value;
  const next = el<HTMLInputElement>('next').value;
  const again = el<HTMLInputElement>('again').value;
  error.textContent = '';
  if (next.length < 10) {
    error.textContent = 'Use at least 10 characters.';
    return;
  }
  if (next !== again) {
    error.textContent = 'The two new passwords do not match.';
    return;
  }
  busy(button, true, 'Save and continue');
  postJson<Redirect>('/api/auth/change-password', { current, next })
    .then((result) => window.location.replace(result.redirect))
    .catch((failure: unknown) => {
      busy(button, false, 'Save and continue');
      error.textContent = failure instanceof ApiError ? failure.message : 'Something went wrong. Please try again.';
    });
});
