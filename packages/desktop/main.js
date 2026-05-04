const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development' || process.env.DEV_URL;
const DEV_URL = process.env.DEV_URL || 'http://localhost:5173';

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#111827',
    title: 'Entity',
    icon: path.join(__dirname, 'icon.png'),
  });

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Inject drag region CSS for macOS title bar
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      body { -webkit-app-region: no-drag; }
      .titlebar-drag { -webkit-app-region: drag; height: 38px; position: fixed; top: 0; left: 78px; right: 0; z-index: 1000; }
    `);
    win.webContents.executeJavaScript(`
      const dragDiv = document.createElement('div');
      dragDiv.className = 'titlebar-drag';
      document.body.prepend(dragDiv);
    `);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.setName('Entity');
