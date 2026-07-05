const { app, BrowserWindow, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// The Entity frontend is server-rendered from packages/server (same-origin
// /api + WebSocket). A file:// renderer copy cannot work, so the desktop app
// always points at a running server — spawning one locally when needed.
const ENTITY_URL = (process.env.ENTITY_URL || process.env.DEV_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const SERVER_SPAWN_TIMEOUT_MS = 60_000;

let serverChild = null;
let quitting = false;

function configureSqlitePath() {
  const dbDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, 'entity-tasks.db');
  process.env.ENTITY_TASK_DB_PATH = process.env.ENTITY_TASK_DB_PATH || dbPath;
  process.env.ENTITY_DB_PATH = process.env.ENTITY_DB_PATH || dbPath;
  return dbPath;
}

function probeServer(url) {
  return new Promise((resolve) => {
    const request = http.get(`${url}/api/runtime`, { timeout: 2_000 }, (response) => {
      response.resume();
      resolve(response.statusCode !== undefined && response.statusCode < 500);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

function findRepoRoot() {
  // Dev checkout layout: <repo>/electron/main.js
  const candidate = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(candidate, 'package.json')) && fs.existsSync(path.join(candidate, 'packages', 'server'))) {
    return candidate;
  }
  return null;
}

function spawnLocalServer(repoRoot) {
  const url = new URL(ENTITY_URL);
  const child = spawn('npm', ['run', 'dev'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: url.hostname,
      PORT: url.port || '3000',
      ENTITY_CLICKCLACK_SIDECAR: process.env.ENTITY_CLICKCLACK_SIDECAR ?? '0',
    },
    stdio: 'ignore',
    detached: false,
  });
  child.on('exit', (code) => {
    if (!quitting) {
      console.warn(`[desktop] Entity server exited with code ${code ?? 'unknown'}`);
    }
  });
  return child;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeServer(url)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

function connectingHtml(message) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><title>Entity</title><style>
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0b0b0d; color:#9a9aa2; font-family:system-ui,sans-serif; }
  .box { text-align:center; max-width:420px; padding:0 24px; }
  .dot { width:10px; height:10px; border-radius:999px; background:#00aaff; margin:0 auto 16px;
         animation:pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity:.25; transform:scale(.8); } }
  h1 { color:#e8e8ec; font-size:18px; font-weight:600; margin:0 0 8px; }
  p { font-size:13px; line-height:1.6; margin:0; }
  code { color:#c8c8d0; background:#1a1a1e; border-radius:6px; padding:1px 6px; }
</style></head><body><div class="box"><div class="dot"></div><h1>Entity</h1><p>${message}</p></div></body></html>`)}`;
}

function createMenu(mainWindow) {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow(),
        },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(process.platform === 'darwin' ? [{ role: 'front' }] : [{ role: 'close' }])],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Entity Documentation',
          click: () => shell.openExternal('https://github.com/h-mascot/entity'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  if (!mainWindow.isDestroyed() && process.platform !== 'darwin') {
    mainWindow.setMenu(menu);
  }
}

async function loadEntity(mainWindow) {
  if (await probeServer(ENTITY_URL)) {
    await mainWindow.loadURL(ENTITY_URL);
    return;
  }

  const repoRoot = findRepoRoot();
  if (repoRoot && !serverChild) {
    await mainWindow.loadURL(connectingHtml('Starting the local Entity server…'));
    serverChild = spawnLocalServer(repoRoot);
    if (await waitForServer(ENTITY_URL, SERVER_SPAWN_TIMEOUT_MS)) {
      await mainWindow.loadURL(ENTITY_URL);
      return;
    }
  }

  await mainWindow.loadURL(
    connectingHtml(
      `Could not reach the Entity server at <code>${ENTITY_URL}</code>. ` +
        'Start it with <code>npm run dev</code> (or set <code>ENTITY_URL</code>) — this window retries automatically.',
    ),
  );

  const retry = setInterval(async () => {
    if (mainWindow.isDestroyed()) {
      clearInterval(retry);
      return;
    }
    if (await probeServer(ENTITY_URL)) {
      clearInterval(retry);
      await mainWindow.loadURL(ENTITY_URL);
    }
  }, 2_000);
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#000000',
    show: false,
    title: 'Entity',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  void loadEntity(mainWindow);

  createMenu(mainWindow);
  return mainWindow;
}

app.whenReady().then(() => {
  configureSqlitePath();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  quitting = true;
  if (serverChild && !serverChild.killed) {
    serverChild.kill('SIGTERM');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
