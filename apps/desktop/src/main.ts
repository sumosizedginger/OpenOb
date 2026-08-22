import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import {
  DesktopVaultRuntime,
  DesktopSecretStore,
  DesktopBootstrapConfig,
  DesktopAppInfo,
  DesktopConfig,
} from '@okw/desktop';
import { startGateway, RunningGateway } from '@okw/gateway';
import { AIManager } from '@okw/ai';

declare const __dirname: string;

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
let isQuitting = false;

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
  // Try relative monorepo path first, then app packaged path
  const localDist = path.resolve(__dirname, '../../../apps/web/dist');
  if (fs.existsSync(localDist)) {
    return localDist;
  }
  const appWebDist = path.resolve(__dirname, '../web');
  if (fs.existsSync(appWebDist)) {
    return appWebDist;
  }
  return path.resolve(process.cwd(), 'apps/web/dist');
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
// 3. Gateway & Runtime Lifecycle (Sections 1, 2, 6, 7, 8)
// ---------------------------------------------------------------------------
async function startSessionForVault(targetVaultPath: string): Promise<DesktopSession> {
  const resolvedVaultPath = path.resolve(targetVaultPath);
  if (!fs.existsSync(resolvedVaultPath)) {
    fs.mkdirSync(resolvedVaultPath, { recursive: true });
  }

  const vaultName = path.basename(resolvedVaultPath);
  const databasePath = getVaultCacheDbPath(resolvedVaultPath);
  const secretsPath = getSecretsPath();

  // 1. Resolve master secret via Electron safeStorage
  const { secret: masterSecret, storageStatus } = getMasterSecret();
  const secretStore = new DesktopSecretStore({
    storagePath: secretsPath,
    masterSecret,
  });

  const effectiveStorageStatus = secretStore.getLoadError() ? 'corrupted' : storageStatus;

  // 2. Initialize DesktopVaultRuntime (One canonical workspace + watcher)
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

  // 5. Start embedded OpenOb Gateway on ephemeral loopback port (127.0.0.1:0) with full desktop scopes
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
// 4. Main Window Creation & Hardened Browser Settings (Sections 4, 29, 30)
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

  // Security: Harden window.open and navigation
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, navUrl) => {
    const isGatewayOrigin = currentSession && navUrl.startsWith(currentSession.gateway.url);
    const isDevVite =
      navUrl.startsWith('http://localhost:5173') || navUrl.startsWith('http://127.0.0.1:5173');
    if (!isGatewayOrigin && !isDevVite) {
      event.preventDefault();
      if (navUrl.startsWith('https://') || navUrl.startsWith('http://')) {
        void shell.openExternal(navUrl);
      }
    }
  });

  // Window bounds persistence
  win.on('close', () => {
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
// 5. IPC Registration (Sections 5, 10, 31, 32)
// ---------------------------------------------------------------------------
function registerIpcHandlers(): void {
  ipcMain.handle('desktop:get-bootstrap', async (): Promise<DesktopBootstrapConfig> => {
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

  ipcMain.handle('desktop:choose-vault', async (): Promise<DesktopBootstrapConfig | null> => {
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select OpenOb Vault Directory',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = result.filePaths[0];

    // 1. Notify renderer before switching
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:lifecycle-event', {
        type: 'before-vault-switch',
        payload: { nextVaultPath: selectedPath },
      });
    }

    // 2. Stop existing gateway & runtime
    await stopCurrentSession();

    // 3. Start new session on selected vault
    currentSession = await startSessionForVault(selectedPath);

    // 4. Save last opened vault
    saveDesktopConfig({
      ...loadDesktopConfig(),
      lastVaultPath: selectedPath,
    });

    // 5. Notify renderer of switch
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

  ipcMain.handle('desktop:get-info', async (): Promise<DesktopAppInfo> => {
    return {
      name: 'OpenOb',
      version: app.getVersion(),
      platform: process.platform,
      storageStatus: currentSession?.storageStatus ?? 'unavailable',
    };
  });
}

// ---------------------------------------------------------------------------
// 6. Application Startup & Shutdown (Sections 35, 36)
// ---------------------------------------------------------------------------
void app.whenReady().then(async () => {
  // Set explicit Windows Application User Model ID for taskbar grouping & icon
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.openob.app');
  }

  registerIpcHandlers();

  // 1. Determine initial vault directory
  const config = loadDesktopConfig();
  let initialVault = config.lastVaultPath;
  if (!initialVault || !fs.existsSync(initialVault)) {
    initialVault = path.join(app.getPath('documents'), 'OpenOb Vault');
  }

  // 2. Start initial gateway session
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

  // 3. Create browser window and load application
  mainWindow = await createMainWindow();

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // Load through the embedded Gateway HTTP server
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

app.on('before-quit', async (event) => {
  if (!isQuitting) {
    isQuitting = true;
    event.preventDefault();
    await stopCurrentSession();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
