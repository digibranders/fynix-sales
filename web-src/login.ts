import { ApiError, getJson, postJson } from './shared/api.js';
import { busy, el } from './shared/dom.js';
import { wirePasswordToggles } from './shared/password.js';
import { startQuotes } from './shared/quotes.js';
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

if (document.getElementById('stair')) {
  startQuotes();
}
wirePasswordToggles();

// Short and Sweet Sales Motivation Quotes Rotator
interface MotivationQuote {
  readonly text: string;
  readonly author: string;
}

const MOTIVATION_QUOTES: readonly MotivationQuote[] = [
  { text: '“Every ‘no’ brings you one step closer to a ‘yes.’”', author: '— Mark Cuban' },
  { text: '“Small daily calls become the big month.”', author: '— Sales Momentum' },
  { text: '“Follow up. The deal is usually hiding in the third conversation.”', author: '— Sales Playbook' },
  { text: '“Opportunities don’t happen. You create them.”', author: '— Chris Grosser' },
  { text: '“Be useful before you are persuasive.”', author: '— Brian Halligan' },
  { text: '“Listen twice as long as you talk.”', author: '— Epictetus' },
  { text: '“Action is the foundational key to all success.”', author: '— Pablo Picasso' },
  { text: '“Your pipeline is your momentum. Keep it moving.”', author: '— Fynix Sales' },
  { text: '“The secret of getting ahead is getting started.”', author: '— Mark Twain' },
  { text: '“Focus on adding genuine value, and the numbers will follow.”', author: '— Zig Ziglar' },
];

function initMotivationQuotes(): void {
  const fader = document.getElementById('quote-fader');
  const textEl = document.getElementById('quote-text');
  const authorEl = document.getElementById('quote-author');
  if (!fader || !textEl || !authorEl) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let current = Math.floor(Math.random() * MOTIVATION_QUOTES.length);

  const applyQuote = (idx: number): void => {
    const q = MOTIVATION_QUOTES[idx];
    if (!q) return;
    textEl.textContent = q.text;
    authorEl.textContent = q.author;
  };

  applyQuote(current);
  if (reduceMotion) return;

  const ROTATE_INTERVAL_MS = 6000;
  const FADE_TRANSITION_MS = 350;
  let timer: number | undefined;

  const stepNext = (): void => {
    fader.classList.add('fading');
    window.setTimeout(() => {
      current = (current + 1) % MOTIVATION_QUOTES.length;
      applyQuote(current);
      fader.classList.remove('fading');
    }, FADE_TRANSITION_MS);
  };

  const startTimer = (): void => {
    window.clearInterval(timer);
    timer = window.setInterval(stepNext, ROTATE_INTERVAL_MS);
  };

  startTimer();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      window.clearInterval(timer);
    } else {
      startTimer();
    }
  });
}

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
