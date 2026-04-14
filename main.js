const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { startServer } = require('./server/index');

// ── Auto-updater config ────────────────────────────────────────────────────────
autoUpdater.autoDownload         = false;  // ask user first
autoUpdater.autoInstallOnAppQuit = true;   // install when user quits after accepting

autoUpdater.on('update-available', (info) => {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Available',
    message: `VertiCut ${info.version} is available`,
    detail: `You have v${app.getVersion()}. Download and install the update now?\n\nThe update will download in the background and install when you restart.`,
    buttons: ['Download Update', 'Skip'],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) autoUpdater.downloadUpdate();
  });
});

autoUpdater.on('update-downloaded', () => {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Ready',
    message: 'Update downloaded',
    detail: 'Restart VertiCut now to apply the update, or it will install automatically next time you quit.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) autoUpdater.quitAndInstall();
  });
});

autoUpdater.on('error', () => {}); // silently ignore network / update errors

// ── Window ─────────────────────────────────────────────────────────────────────
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
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.maximize();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Check for updates 4 seconds after launch so it doesn't block startup
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 4000);
}

ipcMain.handle('show-save-dialog', async (event, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, opts);
  return result;
});

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

app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => { if (mainWindow === null) createWindow(); });
