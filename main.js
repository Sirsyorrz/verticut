const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server/index');

const PORT = 47891;
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 960,
    minHeight: 600,
    title: 'VertiCut',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Allow the renderer to load video served from localhost
      webSecurity: true
    },
    // Remove default menu bar
    autoHideMenuBar: true
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.maximize();

  // Open external links in the system browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');

  try {
    await startServer(PORT, userDataPath);
    createWindow();
  } catch (err) {
    console.error('Failed to start embedded server:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
