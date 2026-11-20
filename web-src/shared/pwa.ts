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
  interface Window {
    promptPwaInstall?: () => Promise<boolean>;
  }
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const installListeners: Array<(canInstall: boolean) => void> = [];

export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    Boolean((window.navigator as unknown as { standalone?: boolean }).standalone)
  );
}

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
  try {
    await deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    notifyInstallListeners();
    hideInstallBanner();
    return choice.outcome === 'accepted';
  } catch (err) {
    console.error('[PWA] Prompt failed:', err);
    return false;
  }
}

function notifyInstallListeners(): void {
  const can = deferredInstallPrompt !== null;
  for (const listener of installListeners) {
    listener(can);
  }
}

export function initPwa(): void {
  if (typeof window === 'undefined') return;

  window.promptPwaInstall = promptPwaInstall;

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
    // Prevent default mini-infobar so our custom banner can handle the prompt explicitly
    e.preventDefault();
    deferredInstallPrompt = e;
    notifyInstallListeners();
    window.dispatchEvent(new CustomEvent('pwa-can-install', { detail: { prompt: promptPwaInstall } }));

    // Show custom mobile install banner
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => showInstallBanner(), { once: true });
    } else {
      showInstallBanner();
    }
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App successfully installed');
    deferredInstallPrompt = null;
    notifyInstallListeners();
    hideInstallBanner();
    window.dispatchEvent(new CustomEvent('pwa-installed'));
  });

  // 3. Online / Offline status notification & iOS prompt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupNetworkBanner();
      checkIosPrompt();
    });
  } else {
    setupNetworkBanner();
    checkIosPrompt();
  }
}

function getBannerBottomOffset(): string {
  // If tabs exist in DOM (e.g. sales app view on mobile), place banner above tab bar
  const hasTabs = !!document.querySelector('.tabs');
  return hasTabs
    ? 'calc(68px + env(safe-area-inset-bottom, 0px))'
    : 'calc(16px + env(safe-area-inset-bottom, 0px))';
}

export function showInstallBanner(): void {
  if (isStandaloneMode()) return;
  if (sessionStorage.getItem('fynix_pwa_dismissed')) return;

  let banner = document.getElementById('pwa-install-banner');
  if (banner) {
    banner.style.display = 'flex';
    requestAnimationFrame(() => {
      if (banner) {
        banner.style.opacity = '1';
        banner.style.transform = 'translateX(-50%) translateY(0)';
      }
    });
    return;
  }

  banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Install App');

  const bottomOffset = getBannerBottomOffset();

  banner.style.cssText = [
    'position: fixed',
    `bottom: ${bottomOffset}`,
    'left: 50%',
    'transform: translateX(-50%) translateY(120px)',
    'width: min(440px, calc(100vw - 24px))',
    'background: #0f172a',
    'color: #ffffff',
    'border: 1px solid rgba(255, 255, 255, 0.16)',
    'border-radius: 14px',
    'padding: 10px 14px',
    'box-shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.25)',
    'display: flex',
    'align-items: center',
    'gap: 12px',
    'z-index: 9998',
    'opacity: 0',
    'transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'box-sizing: border-box',
    '-webkit-font-smoothing: antialiased',
  ].join(';');

  banner.innerHTML = `
    <img src="/assets/icons/icon-192.png" width="40" height="40" style="border-radius:9px;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,0.3);object-fit:cover" alt="Fynix">
    <div style="flex:1;min-width:0;text-align:left;">
      <div style="font-weight:600;font-size:13.5px;line-height:1.2;color:#ffffff;margin-bottom:2px">Fynix Sales</div>
      <div style="font-size:11.5px;color:#94a3b8;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Install app for fast access & offline</div>
    </div>
    <button id="pwa-install-btn" type="button" style="background:#2563eb;color:#ffffff;border:none;border-radius:8px;padding:7px 15px;font-weight:600;font-size:13px;cursor:pointer;flex-shrink:0;transition:background 0.15s ease;-webkit-tap-highlight-color:transparent">Install</button>
    <button id="pwa-dismiss-btn" type="button" style="background:transparent;border:none;color:#94a3b8;padding:6px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;-webkit-tap-highlight-color:transparent" aria-label="Dismiss">✕</button>
  `;

  document.body.appendChild(banner);

  const installBtn = banner.querySelector<HTMLButtonElement>('#pwa-install-btn');
  const dismissBtn = banner.querySelector<HTMLButtonElement>('#pwa-dismiss-btn');

  installBtn?.addEventListener('click', async () => {
    installBtn.textContent = 'Opening…';
    installBtn.disabled = true;
    const accepted = await promptPwaInstall();
    if (!accepted) {
      installBtn.textContent = 'Install';
      installBtn.disabled = false;
    }
  });

  dismissBtn?.addEventListener('click', () => {
    sessionStorage.setItem('fynix_pwa_dismissed', '1');
    hideInstallBanner();
  });

  requestAnimationFrame(() => {
    if (banner) {
      banner.style.opacity = '1';
      banner.style.transform = 'translateX(-50%) translateY(0)';
    }
  });
}

export function hideInstallBanner(): void {
  const banner = document.getElementById('pwa-install-banner');
  if (!banner) return;
  banner.style.opacity = '0';
  banner.style.transform = 'translateX(-50%) translateY(120px)';
  setTimeout(() => {
    banner.remove();
  }, 350);
}

function checkIosPrompt(): void {
  if (isStandaloneMode()) return;
  if (sessionStorage.getItem('fynix_pwa_dismissed')) return;

  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua) && !('MSStream' in window);
  const isSafari = isIos && /safari/.test(ua) && !/crios|fxios|opios|mercury/.test(ua);

  if (!isSafari) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Install App');

  const bottomOffset = getBannerBottomOffset();

  banner.style.cssText = [
    'position: fixed',
    `bottom: ${bottomOffset}`,
    'left: 50%',
    'transform: translateX(-50%) translateY(120px)',
    'width: min(440px, calc(100vw - 24px))',
    'background: #0f172a',
    'color: #ffffff',
    'border: 1px solid rgba(255, 255, 255, 0.16)',
    'border-radius: 14px',
    'padding: 10px 14px',
    'box-shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.25)',
    'display: flex',
    'align-items: center',
    'gap: 12px',
    'z-index: 9998',
    'opacity: 0',
    'transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'box-sizing: border-box',
    '-webkit-font-smoothing: antialiased',
  ].join(';');

  banner.innerHTML = `
    <img src="/assets/icons/icon-192.png" width="38" height="38" style="border-radius:8px;flex-shrink:0" alt="Fynix">
    <div style="flex:1;min-width:0;text-align:left;font-size:12px;line-height:1.3;color:#e2e8f0;">
      Install Fynix Sales: tap <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;display:inline-block"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> then <b>"Add to Home Screen"</b>
    </div>
    <button id="pwa-ios-dismiss-btn" type="button" style="background:transparent;border:none;color:#94a3b8;padding:6px;cursor:pointer;flex-shrink:0;font-size:16px;line-height:1" aria-label="Dismiss">✕</button>
  `;

  document.body.appendChild(banner);

  banner.querySelector('#pwa-ios-dismiss-btn')?.addEventListener('click', () => {
    sessionStorage.setItem('fynix_pwa_dismissed', '1');
    hideInstallBanner();
  });

  requestAnimationFrame(() => {
    banner.style.opacity = '1';
    banner.style.transform = 'translateX(-50%) translateY(0)';
  });
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
      'top: 16px',
      'left: 50%',
      'transform: translateX(-50%) translateY(-100px)',
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

  const showStatus = (text: string, isOnline: boolean) => {
    if (!banner) return;
    const dotColor = isOnline ? '#22c55e' : '#ef4444';
    banner.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${dotColor};display:inline-block"></span> ${text}`;
    banner.style.opacity = '1';
    banner.style.transform = 'translateX(-50%) translateY(0)';
    if (isOnline) {
      setTimeout(() => {
        if (banner) {
          banner.style.opacity = '0';
          banner.style.transform = 'translateX(-50%) translateY(-100px)';
        }
      }, 3000);
    }
  };

  window.addEventListener('offline', () => {
    showStatus('You are currently offline. Showing cached data.', false);
  });

  window.addEventListener('online', () => {
    showStatus('Back online. Syncing...', true);
  });
}
