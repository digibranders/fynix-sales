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

/** Fades through the sales quotes on the left panel, pausing while the tab is hidden. */
export function initMotivationQuotes(): void {
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
