import { el } from './dom.js';

/** One encouraging line per pipeline step. The runner on the staircase stands on the step for the line on screen. */
const LINES: readonly string[] = [
  'Every lead starts as a stranger. Make the first call worth remembering.',
  'Follow up. The deal is usually hiding in the third conversation.',
  'Listen twice as long as you talk. They will tell you how to sell to them.',
  'Be useful before you are persuasive.',
  'A no today is just a yes that has not found its moment yet.',
  'Small calls, made daily, become the big month.',
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const STEP_WIDTH = 70;
const GAP = 6;
const LEFT = 30;
const BASE = 290;
const ROTATE_MS = 7500;
const FADE_MS = 380;

interface Step {
  rect: SVGRectElement;
  centreX: number;
  top: number;
}

/** Starts the rotating quotes and the climbing runner on the art side of the sign-in and invite pages. */
export function startQuotes(): void {
  const art = el('art');
  const text = el('q-text');
  const count = el('count');
  const runner = el<HTMLElement>('runner');
  const stair = el('stair');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const steps: Step[] = LINES.map((_, i) => {
    const height = 40 + i * 30;
    const x = LEFT + i * (STEP_WIDTH + GAP);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(BASE - height));
    rect.setAttribute('width', String(STEP_WIDTH));
    rect.setAttribute('height', String(height));
    rect.setAttribute('rx', '4');
    stair.appendChild(rect);
    return { rect, centreX: x + STEP_WIDTH / 2, top: BASE - height };
  });

  const two = (n: number): string => String(n).padStart(2, '0');
  let index = 0;
  let timer: number | undefined;
  let swap: number | undefined;

  function paintStage(): void {
    const step = steps[index];
    if (!step) return;
    count.textContent = `${two(index + 1)} / ${two(LINES.length)}`;
    steps.forEach((s, i) => s.rect.setAttribute('fill', i === index ? '#2fb36d' : i < index ? '#25774d' : '#1c5a3c'));
    runner.style.transform = `translate(${step.centreX}px,${step.top}px)`;
  }
  const paintText = (): void => {
    text.textContent = LINES[index] ?? '';
  };

  function show(next: number): void {
    const target = (next + LINES.length) % LINES.length;
    if (target === index) return;
    index = target;
    paintStage();
    if (reduceMotion) {
      paintText();
      return;
    }
    art.classList.add('out');
    window.clearTimeout(swap);
    swap = window.setTimeout(() => {
      paintText();
      art.classList.remove('out');
    }, FADE_MS);
  }

  function restart(): void {
    window.clearInterval(timer);
    if (!reduceMotion) timer = window.setInterval(() => show(index + 1), ROTATE_MS);
  }

  el('prev').addEventListener('click', () => {
    show(index - 1);
    restart();
  });
  el('next-q').addEventListener('click', () => {
    show(index + 1);
    restart();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.clearInterval(timer);
    else restart();
  });

  paintStage();
  paintText();
  restart();
}
