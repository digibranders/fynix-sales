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

const signin = el<HTMLFormElement>('signin');
const change = el<HTMLFormElement>('change');

function showChange(): void {
  signin.hidden = true;
  change.hidden = false;
  el('next').focus();
}

el('forgot').addEventListener('click', () => {
  const note = el('forgot-note');
  note.hidden = !note.hidden;
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
