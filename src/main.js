/**
 * Application configuration schema
 * @typedef {Object} AppConfig
 * @property {string} name - The application name displayed in UI elements and window title
 * @property {string} url - The web URL that the application will load
 * @property {string} iconFile - The filename of the icon used for the application window and tray
 * @property {string} userAgent - Custom user agent string to use for web requests
 * @property {Object} windowOptions - Configuration options for the application window
 * @property {number} windowOptions.width - Initial window width in pixels
 * @property {number} windowOptions.height - Initial window height in pixels
 * @property {number} windowOptions.minWidth - Minimum allowed window width in pixels
 * @property {number} windowOptions.minHeight - Minimum allowed window height in pixels
 * @property {string[]} permissions - Array of permissions to grant to the web application
 * @property {string} snapName - Application name used for Snap packaging
 * @property {string} snapDescription - Application description used for Snap packaging
 * @property {string} desktopName - Display name used in desktop environments
 * @property {string} desktopCategories - Categories for desktop environment integration
 */
const appConfig = require('./app-config.json');

const {app, BrowserWindow, session} = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');

const {setupTray} = require('./main/tray');
const {setupNotifications} = require('./main/notification');

const icon = path.join(__dirname, 'icons', appConfig.iconFile);

app.name = appConfig.name;

if (process.platform === 'win32') {
  app.setAppUserModelId(appConfig.name);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  let mainWindow;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  function createWindow() {
    const mainWindowState = windowStateKeeper({
      defaultWidth: appConfig.windowOptions.width,
      defaultHeight: appConfig.windowOptions.height,
      file: 'window-state.json'
    });

    mainWindow = new BrowserWindow({
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      minWidth: appConfig.windowOptions.minWidth,
      minHeight: appConfig.windowOptions.minHeight,
      icon: icon,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        autoplayPolicy: 'user-gesture-required' // From window.js
      }
    });

    mainWindow.webContents.setUserAgent(appConfig.userAgent);
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowedPermissions = appConfig.permissions || [];
      callback(allowedPermissions.includes(permission));
    });

    mainWindow.loadURL(appConfig.url).catch(r => console.error('Error loading URL:', r));
    mainWindowState.manage(mainWindow);

    // Add functionality from window.js
    setupExternalLinks(mainWindow);
    setupCloseEvent(mainWindow);

    mainWindow.on('focus', () => {
      if (process.platform === 'win32') {
        mainWindow.flashFrame(false);
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    return mainWindow;
  }

  // Functions from window.js
  function setupExternalLinks(window) {
    console.log('Setting up external links handlers');

    window.webContents.setWindowOpenHandler((details) => {
      if (details.url.includes(new URL(appConfig.url).hostname) ||
          details.url.includes('login.microsoftonline.com')) {
        return {action: 'allow'};
      }

      if (details.url.startsWith('https://') || details.url.startsWith('http://')) {
        require('electron').shell.openExternal(details.url)
          .catch(err => console.error('Error loading URL:', err));
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

  // App startup
  app.whenReady().then(async () => {
    await session.defaultSession.clearCache();

    mainWindow = createWindow();

    await setupTray(mainWindow, {
      name: appConfig.name,
      iconPath: icon
    });

    setupNotifications(mainWindow);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
}