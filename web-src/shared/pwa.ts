/** PWA registration, install prompt handling, and network status notifications */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const installListeners: Array<(canInstall: boolean) => void> = [];

export function onInstallAvailabilityChange(listener: (canInstall: boolean) => void): () => void {
  installListeners.push(listener);
  listener(deferredInstallPrompt !== null);
  return () => {
    const idx = installListeners.indexOf(listener);
    if (idx !== -1) installListeners.splice(idx, 1);
  };
}

export async function promptPwaInstall(): Promise<boolean> {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  notifyInstallListeners();
  return choice.outcome === 'accepted';
}

function notifyInstallListeners() {
  const can = deferredInstallPrompt !== null;
  for (const listener of installListeners) {
    listener(can);
  }
}

export function initPwa(): void {
  // 1. Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[PWA] Service Worker registered with scope:', reg.scope);
      } catch (err) {
        console.error('[PWA] Service Worker registration failed:', err);
      }
    });
  }

  // 2. Install Prompt (A2HS)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    notifyInstallListeners();
    window.dispatchEvent(new CustomEvent('pwa-can-install', { detail: { prompt: promptPwaInstall } }));
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App successfully installed');
    deferredInstallPrompt = null;
    notifyInstallListeners();
    window.dispatchEvent(new CustomEvent('pwa-installed'));
  });

  // 3. Online / Offline status notification
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupNetworkBanner);
  } else {
    setupNetworkBanner();
  }
}

function setupNetworkBanner(): void {
  let banner = document.getElementById('pwa-network-status');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'pwa-network-status';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText = [
      'position: fixed',
      'bottom: 16px',
      'left: 50%',
      'transform: translateX(-50%) translateY(100px)',
      'background: #1e293b',
      'color: #f8fafc',
      'border: 1px solid #475569',
      'padding: 8px 16px',
      'border-radius: 9999px',
      'font-size: 13px',
      'font-weight: 500',
      'box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3)',
      'display: flex',
      'align-items: center',
      'gap: 8px',
      'z-index: 9999',
      'transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
      'opacity: 0',
      'pointer-events: none',
    ].join(';');
    document.body.appendChild(banner);
  }

  const showBanner = (text: string, isOnline: boolean) => {
    if (!banner) return;
    const dotColor = isOnline ? '#22c55e' : '#ef4444';
    banner.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${dotColor};display:inline-block"></span> ${text}`;
    banner.style.opacity = '1';
    banner.style.transform = 'translateX(-50%) translateY(0)';
    if (isOnline) {
      setTimeout(() => {
        if (banner) {
          banner.style.opacity = '0';
          banner.style.transform = 'translateX(-50%) translateY(100px)';
        }
      }, 3000);
    }
  };

  window.addEventListener('offline', () => {
    showBanner('You are currently offline. Showing cached data.', false);
  });

  window.addEventListener('online', () => {
    showBanner('Back online. Syncing...', true);
  });
}
