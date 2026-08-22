import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  safeStorage,
  Menu,
  type IpcMainInvokeEvent,
} from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import {
  DesktopVaultRuntime,
  DesktopSecretStore,
  DesktopBootstrapConfig,
  DesktopAppInfo,
  DesktopConfig,
  OnboardingState,
  DesktopFlushResult,
  migrateLegacyProfile,
} from '@okw/desktop';
import { startGateway, RunningGateway } from '@okw/gateway';
import { AIManager } from '@okw/ai';

declare const __dirname: string;

// Normalize canonical product identity before any userData path is queried
app.name = 'OpenOb';

// ---------------------------------------------------------------------------
// 0. E2E & Test Isolation / UserData Path Override
// ---------------------------------------------------------------------------
const isE2EMode = process.env.OPENOB_E2E === '1';
const e2eUserDataEnv = process.env.OPENOB_E2E_USER_DATA;
const userDataArg = process.argv.find((arg) => arg.startsWith('--user-data-dir='));

if (isE2EMode && e2eUserDataEnv) {
  const resolvedE2EPath = path.resolve(e2eUserDataEnv);
  if (!fs.existsSync(resolvedE2EPath)) {
    fs.mkdirSync(resolvedE2EPath, { recursive: true });
  }
  app.setPath('userData', resolvedE2EPath);
} else if (userDataArg) {
  const customUserData = path.resolve(userDataArg.split('=')[1]);
  if (!fs.existsSync(customUserData)) {
    fs.mkdirSync(customUserData, { recursive: true });
  }
  app.setPath('userData', customUserData);
} else {
  // Production / normal launch: perform safe one-time migration from legacy profile if present
  try {
    const canonicalDir = app.getPath('userData');
    const appData = app.getPath('appData');
    const legacyDir = path.join(appData, '@okw', 'desktop-app');
    const legacyDirAlt = path.join(appData, '@okw/desktop-app');

    const sourceLegacy = fs.existsSync(legacyDir)
      ? legacyDir
      : fs.existsSync(legacyDirAlt)
        ? legacyDirAlt
        : null;

    if (sourceLegacy) {
      const res = migrateLegacyProfile(sourceLegacy, canonicalDir);
      if (res.migrated) {
        console.log(
          `[DesktopMain] Migrated legacy profile from ${sourceLegacy} to ${canonicalDir}:`,
          res.filesMigrated
        );
      }
    }
  } catch (err) {
    console.warn('[DesktopMain] Legacy profile migration check failed:', err);
  }
}

interface DesktopSession {
  runtime: DesktopVaultRuntime;
  gateway: RunningGateway;
  token: string;
  vaultPath: string;
  vaultName: string;
  storageStatus: 'ready' | 'unavailable' | 'corrupted';
}

let mainWindow: BrowserWindow | null = null;
let currentSession: DesktopSession | null = null;
let shutdownInProgress = false;
let shutdownApproved = false;

// ---------------------------------------------------------------------------
// 1. Single Instance Lock (Section 25)
// ---------------------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Configuration & State Management (Section 27)
// ---------------------------------------------------------------------------
function getConfigFilePath(): string {
  return path.join(app.getPath('userData'), 'desktop-config.json');
}

function loadDesktopConfig(): DesktopConfig {
  try {
    const configPath = getConfigFilePath();
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[DesktopMain] Failed to load desktop config:', err);
  }
  return {};
}

function saveDesktopConfig(config: DesktopConfig): void {
  try {
    const configPath = getConfigFilePath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.warn('[DesktopMain] Failed to save desktop config:', err);
  }
}

function getVaultCacheDbPath(vaultPath: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(path.resolve(vaultPath))
    .digest('hex')
    .slice(0, 16);
  const cacheDir = path.join(app.getPath('userData'), 'cache', hash);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return path.join(cacheDir, 'index.db');
}

function getSecretsPath(): string {
  const secretsDir = path.join(app.getPath('userData'), 'secure');
  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true });
  }
  return path.join(secretsDir, 'secrets.json');
}

function getWebDistPath(): string {
  const candidates = [
    path.join(process.resourcesPath, 'web'),
    path.join(__dirname, '../web/dist'),
    path.join(__dirname, '../../web/dist'),
    path.join(__dirname, '../../../apps/web/dist'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) {
      return c;
    }
  }
  return path.join(__dirname, '../web/dist');
}

// ---------------------------------------------------------------------------
// 3. Exact Origin Security & IPC Validation (P1-A)
// ---------------------------------------------------------------------------
function isAllowedNavigation(navUrl: string): boolean {
  try {
    const parsed = new URL(navUrl);
    if (currentSession?.gateway?.url) {
      const gatewayOrigin = new URL(currentSession.gateway.url).origin;
      if (parsed.origin === gatewayOrigin) return true;
    }
    const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
    if (isDev && process.env.VITE_DEV_SERVER_URL) {
      const viteOrigin = new URL(process.env.VITE_DEV_SERVER_URL).origin;
      if (parsed.origin === viteOrigin) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function validateIpcSender(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;
  if (event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!senderUrl) return false;
  return isAllowedNavigation(senderUrl);
}

/**
 * Resolves the OS-protected master secret using Electron safeStorage (DPAPI/Keychain).
 * Fail-closed: if safeStorage is unavailable or corrupt, falls back to transient in-memory key
 * without ever writing plaintext secrets to disk.
 */
function getMasterSecret(): {
  secret: string;
  storageStatus: 'ready' | 'unavailable' | 'corrupted';
} {
  const secureDir = path.join(app.getPath('userData'), 'secure');
  if (!fs.existsSync(secureDir)) {
    fs.mkdirSync(secureDir, { recursive: true });
  }
  const keyFilePath = path.join(secureDir, 'master.key');

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      '[DesktopMain] safeStorage encryption is unavailable on this OS. Using in-memory master key.'
    );
    return {
      secret: crypto.randomBytes(32).toString('hex'),
      storageStatus: 'unavailable',
    };
  }

  try {
    if (fs.existsSync(keyFilePath)) {
      const encryptedKey = fs.readFileSync(keyFilePath);
      const decryptedSecret = safeStorage.decryptString(encryptedKey);
      if (!decryptedSecret || decryptedSecret.length < 32) {
        throw new Error('Decrypted master key is invalid or truncated');
      }
      return {
        secret: decryptedSecret,
        storageStatus: 'ready',
      };
    } else {
      const freshSecret = crypto.randomBytes(32).toString('hex');
      const encryptedKey = safeStorage.encryptString(freshSecret);
      const tmpPath = `${keyFilePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      fs.writeFileSync(tmpPath, encryptedKey);
      fs.renameSync(tmpPath, keyFilePath);
      return {
        secret: freshSecret,
        storageStatus: 'ready',
      };
    }
  } catch (err: any) {
    console.error('[DesktopMain] Failed to decrypt master key file:', err);
    return {
      secret: crypto.randomBytes(32).toString('hex'),
      storageStatus: 'corrupted',
    };
  }
}

// ---------------------------------------------------------------------------
// 4. Session & Runtime Management
// ---------------------------------------------------------------------------
async function startSessionForVault(targetVaultPath: string): Promise<DesktopSession> {
  const resolvedVaultPath = path.resolve(targetVaultPath);
  if (!fs.existsSync(resolvedVaultPath)) {
    fs.mkdirSync(resolvedVaultPath, { recursive: true });
  }

  const vaultName = path.basename(resolvedVaultPath) || 'OpenOb Vault';
  const databasePath = getVaultCacheDbPath(resolvedVaultPath);
  const secretsPath = getSecretsPath();

  // 1. Resolve master secret via Electron safeStorage
  const { secret: masterSecret, storageStatus } = getMasterSecret();
  const secretStore = new DesktopSecretStore({
    storagePath: secretsPath,
    masterSecret,
  });

  const effectiveStorageStatus = secretStore.getLoadError() ? 'corrupted' : storageStatus;

  // 2. Initialize DesktopVaultRuntime
  const runtime = await DesktopVaultRuntime.create({
    vaultPath: resolvedVaultPath,
    databasePath,
    secretsPath,
    masterSecret,
    debounceMs: 50,
  });

  // 3. Initialize AI Manager with desktop secret store
  const aiManager = new AIManager({}, secretStore);

  // 4. Generate high-entropy ephemeral session token
  const sessionToken = `OPENOB_DESKTOP_${crypto.randomUUID()}`;

  // 5. Start embedded OpenOb Gateway on ephemeral loopback port (127.0.0.1:0)
  const gateway = await startGateway({
    workspace: runtime.workspace,
    host: '127.0.0.1',
    port: 0,
    token: sessionToken,
    scopes: [
      'workspace.read',
      'workspace.search',
      'workspace.write',
      'properties.write',
      'workspace.rename',
      'workspace.delete',
      'workspace.views.write',
      'workspace.ai.use',
      'workspace.ai.configure',
    ],
    serveWeb: true,
    webDistPath: getWebDistPath(),
    secretStore,
    aiManager,
  });

  return {
    runtime,
    gateway,
    token: sessionToken,
    vaultPath: resolvedVaultPath,
    vaultName,
    storageStatus: effectiveStorageStatus,
  };
}

async function stopCurrentSession(): Promise<void> {
  if (!currentSession) return;
  const session = currentSession;
  currentSession = null;

  try {
    await session.runtime.close();
  } catch (err) {
    console.error('[DesktopMain] Error closing vault runtime:', err);
  }

  try {
    await session.gateway.stop();
  } catch (err) {
    console.error('[DesktopMain] Error stopping gateway server:', err);
  }
}

function getWindowIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, 'icons/256x256.png'),
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../../apps/desktop/build/icon.png'),
    path.join(__dirname, '../../apps/desktop/build/icon.ico'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 5. Safe Flush Protocol & Central Shutdown Coordinator (P1-B)
// ---------------------------------------------------------------------------
interface PendingFlush {
  resolve: (result: DesktopFlushResult) => void;
  timeoutId: NodeJS.Timeout;
}
const pendingFlushes = new Map<string, PendingFlush>();

async function requestRendererFlush(
  reason: 'close' | 'quit' | 'vault-switch'
): Promise<DesktopFlushResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { requestId: 'none', success: true, conflicts: [], failures: [] };
  }
  const requestId = crypto.randomUUID();
  return new Promise<DesktopFlushResult>((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingFlushes.delete(requestId);
      resolve({
        requestId,
        success: false,
        conflicts: [],
        failures: ['Flush request timed out after 5000ms'],
      });
    }, 5000);

    pendingFlushes.set(requestId, { resolve, timeoutId });

    mainWindow!.webContents.send('desktop:flush-request', { requestId, reason });
  });
}

async function handleApplicationQuit(sourceWin?: BrowserWindow): Promise<void> {
  if (shutdownApproved) {
    app.quit();
    return;
  }
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  try {
    const flushRes = await requestRendererFlush('quit');
    if (flushRes.success) {
      shutdownApproved = true;
      await stopCurrentSession();
      app.quit();
      return;
    }

    const win = sourceWin || mainWindow;
    const choice =
      win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['Cancel', 'Quit Without Saving'],
            defaultId: 0,
            cancelId: 0,
            title: 'Unsaved Changes',
            message: 'Some changes in your notes could not be saved.',
            detail: 'Do you want to return to OpenOb to resolve them, or quit without saving?',
          })
        : { response: 0 };

    if (choice.response === 1) {
      shutdownApproved = true;
      await stopCurrentSession();
      app.quit();
    } else {
      shutdownInProgress = false;
    }
  } catch (err) {
    console.error('[DesktopMain] Error during shutdown handshake:', err);
    shutdownInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// 6. Application Menu (P2-F)
// ---------------------------------------------------------------------------
function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' as const },
    { role: 'editMenu' as const },
    { role: 'viewMenu' as const },
    { role: 'windowMenu' as const },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn OpenOb',
          click: () => {
            mainWindow?.webContents.send('desktop:menu-action', { action: 'learn' });
          },
        },
        {
          label: 'Quick Tour',
          click: () => {
            mainWindow?.webContents.send('desktop:menu-action', { action: 'quick-tour' });
          },
        },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            mainWindow?.webContents.send('desktop:menu-action', { action: 'shortcuts' });
          },
        },
        { type: 'separator' },
        {
          label: 'About OpenOb',
          click: () => {
            mainWindow?.webContents.send('desktop:menu-action', { action: 'about' });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// 7. Main Window Creation & Hardened Browser Settings (P1-A, P1-B)
// ---------------------------------------------------------------------------
async function createMainWindow(): Promise<BrowserWindow> {
  const config = loadDesktopConfig();
  const bounds = config.windowBounds;
  const iconPath = getWindowIconPath();

  const win = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 800,
    minHeight: 600,
    title: 'OpenOb',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (bounds?.maximized) {
    win.maximize();
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, navUrl) => {
    if (!isAllowedNavigation(navUrl)) {
      event.preventDefault();
      if (navUrl.startsWith('https://') || navUrl.startsWith('http://')) {
        void shell.openExternal(navUrl);
      }
    }
  });

  win.on('close', (event) => {
    if (!shutdownApproved) {
      event.preventDefault();
      void handleApplicationQuit(win);
      return;
    }

    if (!win.isDestroyed()) {
      const isMaximized = win.isMaximized();
      const currentBounds = win.getNormalBounds();
      saveDesktopConfig({
        ...loadDesktopConfig(),
        windowBounds: {
          x: currentBounds.x,
          y: currentBounds.y,
          width: currentBounds.width,
          height: currentBounds.height,
          maximized: isMaximized,
        },
      });
    }
  });

  return win;
}

// ---------------------------------------------------------------------------
// 8. IPC Registration (P1-A, P1-B, P2-F, P2-H)
// ---------------------------------------------------------------------------
function registerIpcHandlers(): void {
  ipcMain.handle('desktop:get-bootstrap', async (event): Promise<DesktopBootstrapConfig> => {
    if (!validateIpcSender(event)) throw new Error('Unauthorized IPC sender');
    if (!currentSession) {
      throw new Error('No active desktop session');
    }
    return {
      gatewayUrl: currentSession.gateway.url,
      token: currentSession.token,
      vaultName: currentSession.vaultName,
      vaultPath: currentSession.vaultPath,
      storageStatus: currentSession.storageStatus,
    };
  });

  ipcMain.handle('desktop:choose-vault', async (event): Promise<DesktopBootstrapConfig | null> => {
    if (!validateIpcSender(event)) throw new Error('Unauthorized IPC sender');
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select OpenOb Vault Directory',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = result.filePaths[0];

    const flushRes = await requestRendererFlush('vault-switch');
    if (!flushRes.success) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancel Switch', 'Discard & Switch'],
        defaultId: 0,
        cancelId: 0,
        title: 'Unsaved Changes',
        message: 'Some changes in the current vault could not be saved.',
        detail: 'Switching vaults will discard unsaved edits. Do you want to cancel the switch?',
      });
      if (choice.response === 0) {
        return null;
      }
    }

    await stopCurrentSession();
    currentSession = await startSessionForVault(selectedPath);

    saveDesktopConfig({
      ...loadDesktopConfig(),
      lastVaultPath: selectedPath,
    });

    const newBootstrap: DesktopBootstrapConfig = {
      gatewayUrl: currentSession.gateway.url,
      token: currentSession.token,
      vaultName: currentSession.vaultName,
      vaultPath: currentSession.vaultPath,
      storageStatus: currentSession.storageStatus,
    };

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:lifecycle-event', {
        type: 'vault-switched',
        payload: newBootstrap,
      });
    }

    return newBootstrap;
  });

  ipcMain.handle('desktop:get-info', async (event): Promise<DesktopAppInfo> => {
    if (!validateIpcSender(event)) throw new Error('Unauthorized IPC sender');
    const buildSha = process.env.OPENOB_BUILD_SHA || 'dev';
    const sourceClean =
      process.env.OPENOB_SOURCE_CLEAN === 'true' || process.env.OPENOB_SOURCE_CLEAN === undefined;
    return {
      name: 'OpenOb',
      version: app.getVersion(),
      buildSha,
      sourceClean,
      platform: process.platform,
      storageStatus: currentSession?.storageStatus ?? 'unavailable',
    };
  });

  ipcMain.handle('desktop:get-onboarding-state', async (event): Promise<OnboardingState | null> => {
    if (!validateIpcSender(event)) throw new Error('Unauthorized IPC sender');
    const config = loadDesktopConfig();
    return config.onboardingState ?? null;
  });

  ipcMain.handle(
    'desktop:set-onboarding-state',
    async (event, state: OnboardingState): Promise<void> => {
      if (!validateIpcSender(event)) throw new Error('Unauthorized IPC sender');
      if (state && typeof state === 'object' && typeof state.version === 'number') {
        const config = loadDesktopConfig();
        saveDesktopConfig({
          ...config,
          onboardingState: {
            version: state.version,
            dismissedFirstRun: Boolean(state.dismissedFirstRun),
            quickTourCompleted: Boolean(state.quickTourCompleted),
            completedChapters: Array.isArray(state.completedChapters)
              ? state.completedChapters.map(String)
              : [],
          },
        });
      }
    }
  );

  ipcMain.handle('desktop:get-plugin-states', async (event): Promise<Record<string, boolean>> => {
    if (!validateIpcSender(event)) throw new Error('Unauthorized IPC sender');
    const config = loadDesktopConfig();
    return config.pluginStates || {};
  });

  ipcMain.handle(
    'desktop:set-plugin-states',
    async (event, states: Record<string, boolean>): Promise<void> => {
      if (!validateIpcSender(event)) throw new Error('Unauthorized IPC sender');
      if (!states || typeof states !== 'object' || Array.isArray(states)) {
        throw new Error('Invalid plugin states payload');
      }
      const keys = Object.keys(states);
      if (keys.length > 100) {
        throw new Error('Plugin states payload exceeds limit');
      }
      const cleanStates: Record<string, boolean> = {};
      for (const key of keys) {
        if (typeof key === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(key)) {
          cleanStates[key] = Boolean(states[key]);
        }
      }
      const config = loadDesktopConfig();
      saveDesktopConfig({
        ...config,
        pluginStates: cleanStates,
      });
    }
  );

  ipcMain.handle(
    'desktop:flush-result',
    async (event, result: DesktopFlushResult): Promise<void> => {
      if (!validateIpcSender(event)) throw new Error('Unauthorized IPC sender');
      if (result?.requestId && pendingFlushes.has(result.requestId)) {
        const pending = pendingFlushes.get(result.requestId)!;
        clearTimeout(pending.timeoutId);
        pendingFlushes.delete(result.requestId);
        pending.resolve(result);
      }
    }
  );
}

// ---------------------------------------------------------------------------
// 9. Application Startup & Shutdown (Sections 35, 36)
// ---------------------------------------------------------------------------
void app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.openob.app');
  }

  setupApplicationMenu();
  registerIpcHandlers();

  const config = loadDesktopConfig();
  let initialVault = config.lastVaultPath;
  if (!initialVault || !fs.existsSync(initialVault)) {
    initialVault = path.join(app.getPath('documents'), 'OpenOb Vault');
  }

  try {
    currentSession = await startSessionForVault(initialVault);
  } catch (err) {
    console.error('[DesktopMain] Failed to start initial vault session:', err);
    dialog.showErrorBox(
      'OpenOb Startup Error',
      `Failed to initialize vault at "${initialVault}": ${err instanceof Error ? err.message : String(err)}`
    );
    app.quit();
    return;
  }

  mainWindow = await createMainWindow();

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadURL(currentSession.gateway.url);
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createMainWindow();
      if (currentSession) {
        await mainWindow.loadURL(currentSession.gateway.url);
      }
    }
  });
});

app.on('before-quit', (event) => {
  if (!shutdownApproved) {
    event.preventDefault();
    void handleApplicationQuit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
