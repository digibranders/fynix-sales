import { ApiError, getJson, postJson } from './shared/api.js';
import { busy, el } from './shared/dom.js';
import { wirePasswordToggles } from './shared/password.js';
import { initMotivationQuotes } from './shared/auth-art.js';
import { initPwa } from './shared/pwa.js';

initPwa();

interface InviteInfo {
  name: string;
  email: string;
  reset: boolean;
  expiresAt: number;
}
interface Redirect {
  redirect: string;
}

initMotivationQuotes();
wirePasswordToggles();

const token = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() ?? '');
const endpoint = `/api/auth/invite/${encodeURIComponent(token)}`;
const form = el<HTMLFormElement>('accept');
const bad = el('bad');
const loading = el('loading');
let isReset = false;

function showBad(message?: string): void {
  loading.hidden = true;
  form.hidden = true;
  bad.hidden = false;
  if (message) el('bad-msg').textContent = message;
}

const submitLabel = (): string => (isReset ? 'Save password' : 'Create account');

getJson<InviteInfo>(endpoint)
  .then((info) => {
    isReset = info.reset;
    const first = info.name.split(' ')[0] || 'there';
    el('h').textContent = isReset ? 'Choose a new password' : `Welcome, ${first}`;
    try {
      if (sessionStorage.getItem('fynix_shimmer_seen')) {
        el('h').classList.add('shimmer-done');
      } else {
        sessionStorage.setItem('fynix_shimmer_seen', '1');
      }
    } catch {
      // Ignore in sandboxed / private environments
    }
    el('sub').textContent = isReset ? 'Set a new password for your account.' : 'Choose a password to finish setting up your account.';
    el('go').textContent = submitLabel();
    el<HTMLInputElement>('email').value = info.email;
    loading.hidden = true;
    form.hidden = false;
    el('pw').focus();
  })
  .catch((failure: unknown) => showBad(failure instanceof ApiError ? failure.message : undefined));

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const error = el('err');
  const button = el<HTMLButtonElement>('go');
  const password = el<HTMLInputElement>('pw').value;
  const again = el<HTMLInputElement>('again').value;
  error.textContent = '';
  if (password.length < 10) {
    error.textContent = 'Use at least 10 characters.';
    return;
  }
  if (password !== again) {
    error.textContent = 'The two passwords do not match.';
    return;
  }
  busy(button, true, submitLabel());
  postJson<Redirect>(endpoint, { password })
    .then((result) => window.location.replace(result.redirect))
    .catch((failure: unknown) => {
      if (failure instanceof ApiError && failure.status === 404) {
        showBad(failure.message);
        return;
      }
      busy(button, false, submitLabel());
      error.textContent = failure instanceof ApiError ? failure.message : 'Something went wrong. Please try again.';
    });
});
