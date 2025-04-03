const {BrowserWindow, app, shell} = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');

function createWindow() {

  let mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800
  });

  const mainWindow = new BrowserWindow({
    width: mainWindowState.width,
    height: mainWindowState.height,
    x: mainWindowState.x,
    y: mainWindowState.y,
    webPreferences: {
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/preload.js'),
      autoplayPolicy: 'user-gesture-required'
    },
    icon: path.join(__dirname, '../icons/icon.png')
  });

  mainWindow.removeMenu();
  mainWindow.webContents.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  mainWindow.loadURL('https://teams.microsoft.com')
    .catch(err => console.error('Error loading URL:', err));

  setupPermissions(mainWindow);
  setupExternalLinks(mainWindow);
  setupCloseEvent(mainWindow);

  mainWindow.on('focus', () => {
    if (process.platform === 'win32') {
      mainWindow.flashFrame(false);
    }
  });

  mainWindowState.manage(mainWindow);

  return mainWindow;
}

function setupPermissions(window) {
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications', 'midi', 'midiSysex'];
    callback(allowedPermissions.includes(permission));
  });
}

function setupExternalLinks(window) {
  console.log('Setting up external links handlers');

  window.webContents.setWindowOpenHandler((details) => {

    if (details.url.includes('teams.microsoft.com') ||
            details.url.includes('login.microsoftonline.com')) {
      return {action: 'allow'};
    }

    // noinspection HttpUrlsUsage
    if (details.url.startsWith('https://') || details.url.startsWith('http://')) {
      shell.openExternal(details.url).catch(err => console.error('Error loading URL:', err));
    }

    return {action: 'deny'};
  });
}

function setupCloseEvent(mainWindow) {
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      return false;
    }
    return true;
  });

  app.isQuitting = false;
}

module.exports = {createWindow};