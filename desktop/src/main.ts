/**
 * IbuTest desktop (Electron) main process.
 *
 * Two modes:
 *  - Team server: the window loads your organisation's IbuTest URL (HTTPS only), so the
 *    desktop app gets exactly the same server-side security as the web app.
 *  - Local workspace: the API + web client run inside this process on 127.0.0.1 with an
 *    embedded PostgreSQL (PGlite) database stored in the user's profile folder.
 *
 * Hardening follows the Electron security checklist: sandboxed renderers, context isolation,
 * no Node.js in renderers, strict navigation/window-open policy, deny-all permissions,
 * validated IPC senders, custom protocol instead of file://, and Electron fuses (see
 * electron-builder.config.cjs).
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  app,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  protocol,
  safeStorage,
  session,
  shell,
  type WebContents,
} from 'electron';

app.setName('IbuTest');
const here = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER_ORIGIN = 'app://launcher';
const LAUNCHER_URL = `${LAUNCHER_ORIGIN}/index.html`;
const LAUNCHER_DIR = path.join(here, 'launcher');
const PRELOAD = path.join(here, 'preload.cjs');
const RESOURCES = app.isPackaged ? process.resourcesPath : path.resolve(here, '..', '..');
const CLIENT_DIR = app.isPackaged ? path.join(RESOURCES, 'client') : path.join(RESOURCES, 'client', 'dist');
const MIGRATIONS_DIR = app.isPackaged ? path.join(RESOURCES, 'migrations') : path.join(RESOURCES, 'server', 'drizzle');

type Mode = 'remote' | 'local';
interface DesktopConfig {
  mode: Mode | null;
  serverUrl: string | null;
}

// ------------------------------------------------------------------ persisted settings

const configPath = () => path.join(app.getPath('userData'), 'config.json');
const secretsPath = () => path.join(app.getPath('userData'), 'secrets.bin');

function readConfig(): DesktopConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<DesktopConfig>;
    return {
      mode: raw.mode === 'remote' || raw.mode === 'local' ? raw.mode : null,
      serverUrl: typeof raw.serverUrl === 'string' ? normaliseServerUrl(raw.serverUrl) : null,
    };
  } catch {
    return { mode: null, serverUrl: null };
  }
}

function writeConfig(config: DesktopConfig) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

interface LocalSecrets {
  jwtSecret: string;
  encryptionKey: string;
  anthropicApiKey?: string;
}

/**
 * Local-mode secrets are generated once and stored encrypted with the OS credential store
 * (Keychain / DPAPI / libsecret) through Electron safeStorage.
 */
async function loadSecrets(): Promise<LocalSecrets> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('Secure storage (OS keychain) is not available, so local secrets cannot be protected.');
  }
  if (!fs.existsSync(secretsPath())) {
    const secrets: LocalSecrets = {
      jwtSecret: randomBytes(48).toString('base64url'),
      encryptionKey: randomBytes(32).toString('base64'),
    };
    await saveSecrets(secrets);
    return secrets;
  }
  // Never silently regenerate: a new ENCRYPTION_KEY would make stored 2FA secrets unreadable.
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(fs.readFileSync(secretsPath()));
  const secrets = JSON.parse(result) as LocalSecrets;
  if (shouldReEncrypt) await saveSecrets(secrets);
  return secrets;
}

async function saveSecrets(secrets: LocalSecrets) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(secretsPath(), await safeStorage.encryptStringAsync(JSON.stringify(secrets)), { mode: 0o600 });
}

function normaliseServerUrl(input: string): string | null {
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

// ------------------------------------------------------------------ embedded local server

let localServer: { port: number; close(): Promise<void> } | null = null;
let setupToken: string | null = null;

async function startLocalServer(): Promise<string> {
  if (localServer) return `http://127.0.0.1:${localServer.port}`;
  const secrets = await loadSecrets();
  const dataDir = path.join(app.getPath('userData'), 'workspace');
  setupToken = randomBytes(24).toString('base64url');
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: '0',
    DB_DRIVER: 'pglite',
    PGLITE_DATA_DIR: path.join(dataDir, 'db'),
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
    CLIENT_DIST_DIR: CLIENT_DIR,
    MIGRATIONS_DIR,
    JWT_SECRET: secrets.jwtSecret,
    ENCRYPTION_KEY: secrets.encryptionKey,
    SETUP_TOKEN: setupToken,
    LOG_LEVEL: 'warn',
    ...(secrets.anthropicApiKey ? { ANTHROPIC_API_KEY: secrets.anthropicApiKey } : {}),
  };
  const { startServer } = await import('../../server/src/embedded.js');
  localServer = await startServer(env);
  return `http://127.0.0.1:${localServer.port}`;
}

// ------------------------------------------------------------------ windows & navigation policy

let mainWindow: BrowserWindow | null = null;
/** Origin the main window is currently allowed to show (launcher, local server or team server). */
let allowedOrigin = LAUNCHER_ORIGIN;

/** Origin of a URL, including custom schemes (WHATWG URL reports "null" for app://). */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'app:' ? `app://${parsed.host}` : parsed.origin;
  } catch {
    return null;
  }
}

function isAllowedUrl(url: string): boolean {
  return originOf(url) === allowedOrigin;
}

function openExternalSafely(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'mailto:') void shell.openExternal(parsed.toString());
  } catch {
    /* ignore malformed URLs */
  }
}

function hardenContents(contents: WebContents) {
  // Leaving the app origin in-place is never allowed (phishing via location changes).
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  // New windows are never created; explicit external https links open in the system browser.
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'IbuTest',
    backgroundColor: '#f9f9f7',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: true,
      devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

async function showLauncher() {
  allowedOrigin = LAUNCHER_ORIGIN;
  mainWindow ??= createWindow();
  await mainWindow.loadURL(LAUNCHER_URL);
}

async function openRemote(serverUrl: string) {
  allowedOrigin = originOf(serverUrl) ?? serverUrl;
  mainWindow ??= createWindow();
  await mainWindow.loadURL(`${allowedOrigin}/`);
}

async function openLocal() {
  const base = await startLocalServer();
  allowedOrigin = originOf(base) ?? base;
  mainWindow ??= createWindow();
  let target = `${base}/`;
  try {
    const status = (await (await fetch(`${base}/api/auth/status`)).json()) as { setupRequired?: boolean };
    // The one-time setup token travels in the URL fragment: it never reaches logs or proxies.
    if (status.setupRequired && setupToken) target = `${base}/setup#setupToken=${setupToken}`;
  } catch {
    /* fall through to the app; it will show its own error */
  }
  await mainWindow.loadURL(target);
}

async function openFromConfig() {
  const config = readConfig();
  try {
    if (config.mode === 'remote' && config.serverUrl) return await openRemote(config.serverUrl);
    if (config.mode === 'local') return await openLocal();
  } catch (err) {
    dialog.showErrorBox('IbuTest', `Could not open your workspace: ${(err as Error).message}`);
  }
  return showLauncher();
}

// ------------------------------------------------------------------ IPC (validated senders only)

function senderOrigin(event: IpcMainInvokeEvent): string | null {
  return originOf(event.senderFrame?.url ?? '');
}

function fromLauncher(event: IpcMainInvokeEvent): boolean {
  return senderOrigin(event) === LAUNCHER_ORIGIN && event.sender === mainWindow?.webContents;
}

function registerIpc() {
  ipcMain.handle('desktop:get-config', async (event) => {
    if (!fromLauncher(event)) return null;
    const config = readConfig();
    const hasAiKey = fs.existsSync(secretsPath()) && !!(await loadSecrets().catch(() => null))?.anthropicApiKey;
    return { ...config, hasAiKey, version: app.getVersion() };
  });

  ipcMain.handle('desktop:connect-remote', async (event, rawUrl: unknown) => {
    if (!fromLauncher(event) || typeof rawUrl !== 'string' || rawUrl.length > 2048) return { ok: false, error: 'Invalid request' };
    const serverUrl = normaliseServerUrl(rawUrl);
    if (!serverUrl) return { ok: false, error: 'Enter an https:// address (http is only allowed for localhost).' };
    try {
      const res = await fetch(`${serverUrl}/api/auth/status`, { signal: AbortSignal.timeout(10_000) });
      const body = (await res.json()) as { setupRequired?: unknown };
      if (!res.ok || typeof body.setupRequired !== 'boolean') throw new Error('not an IbuTest server');
    } catch {
      return { ok: false, error: 'Could not reach an IbuTest server at that address.' };
    }
    writeConfig({ mode: 'remote', serverUrl });
    await openRemote(serverUrl);
    return { ok: true };
  });

  ipcMain.handle('desktop:start-local', async (event, options: unknown) => {
    if (!fromLauncher(event)) return { ok: false, error: 'Invalid request' };
    const aiKey = typeof (options as { anthropicApiKey?: unknown })?.anthropicApiKey === 'string' ? (options as { anthropicApiKey: string }).anthropicApiKey.trim() : '';
    try {
      if (aiKey) {
        if (!/^[\w-]{20,300}$/.test(aiKey)) return { ok: false, error: 'That API key does not look valid.' };
        const secrets = await loadSecrets();
        await saveSecrets({ ...secrets, anthropicApiKey: aiKey });
        if (localServer) {
          await localServer.close();
          localServer = null;
        }
      }
      writeConfig({ mode: 'local', serverUrl: null });
      await openLocal();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('desktop:open-launcher', async (event) => {
    if (event.sender !== mainWindow?.webContents || !isAllowedUrl(event.senderFrame?.url ?? '')) return;
    await showLauncher();
  });
}

// ------------------------------------------------------------------ app lifecycle

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);

const CONTENT_TYPES: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const LAUNCHER_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function serveLauncher() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const file = path.normalize(path.join(LAUNCHER_DIR, decodeURIComponent(url.pathname)));
    if (url.host !== 'launcher' || !file.startsWith(LAUNCHER_DIR + path.sep) || !fs.existsSync(file)) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(fs.readFileSync(file), {
      headers: {
        'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': LAUNCHER_CSP,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [{ label: 'Switch server…', accelerator: 'CmdOrCtrl+Shift+S', click: () => void showLauncher() }, { type: 'separator' }, { role: 'quit' }],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.enableSandbox();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('web-contents-created', (_event, contents) => hardenContents(contents));

  app.whenReady().then(async () => {
    // Deny every permission request (camera, microphone, geolocation, notifications…)
    // except writing to the clipboard, which the app uses for "copy" buttons.
    const allowed = new Set(['clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

    serveLauncher();
    registerIpc();
    buildMenu();
    await openFromConfig();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void openFromConfig();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    void localServer?.close();
  });
}
