const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const https = require('https');
const { startServer } = require('./server/index');

function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pb[i] || 0) > (pa[i] || 0)) return true;
    if ((pb[i] || 0) < (pa[i] || 0)) return false;
  }
  return false;
}

function checkForUpdates() {
  const options = {
    hostname: 'api.github.com',
    path: '/repos/Sirsyorrz/verticut/releases/latest',
    headers: { 'User-Agent': 'VertiCut-Updater' }
  };

  https.get(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const release = JSON.parse(data);
        const latestTag = release.tag_name;
        const current = app.getVersion();
        if (!latestTag || !compareSemver(current, latestTag)) return;

        const asset = (release.assets || []).find(a => a.name.endsWith('.exe'));
        const downloadUrl = asset ? asset.browser_download_url : release.html_url;

        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Available',
          message: `VertiCut ${latestTag} is available`,
          detail: `You have v${current}. Download the new version and replace this file to update.`,
          buttons: ['Download Update', 'Skip'],
          defaultId: 0,
          cancelId: 1
        }).then(({ response }) => {
          if (response === 0) shell.openExternal(downloadUrl);
        });
      } catch (e) {
        // Silently ignore parse errors
      }
    });
  }).on('error', () => {}); // Silently ignore network errors
}

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

  setTimeout(checkForUpdates, 3000);
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

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
