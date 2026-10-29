/**
 * Runtime environment detection. The same bundle runs as:
 *  - a web app / PWA served by the IbuTest server (same-origin API),
 *  - the Electron desktop app (which loads the server URL directly, so also same-origin),
 *  - a Capacitor iOS/Android app (bundled; talks to a user-configured HTTPS server).
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}
interface DesktopBridge {
  isDesktop: true;
  platform: string;
  openServerSettings: () => Promise<void>;
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
    ibutestDesktop?: DesktopBridge;
  }
}

const SERVER_KEY = 'ibutest.serverUrl';

export const isNative = (): boolean => !!window.Capacitor?.isNativePlatform?.();
export const desktopBridge = (): DesktopBridge | undefined => window.ibutestDesktop;

export function platformName(): 'web' | 'desktop' | 'ios' | 'android' {
  if (desktopBridge()) return 'desktop';
  if (isNative()) return window.Capacitor?.getPlatform?.() === 'ios' ? 'ios' : 'android';
  return 'web';
}

/** Validates a server URL: HTTPS only, except loopback addresses for local testing. */
export function normaliseServerUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getServerUrl(): string | null {
  if (!isNative()) return null; // web & desktop always talk to their own origin
  try {
    const stored = localStorage.getItem(SERVER_KEY);
    return stored ? normaliseServerUrl(stored) : null;
  } catch {
    return null;
  }
}

export function setServerUrl(url: string | null) {
  try {
    if (url) localStorage.setItem(SERVER_KEY, url);
    else localStorage.removeItem(SERVER_KEY);
  } catch {
    /* storage unavailable - the user will be asked again next launch */
  }
}
