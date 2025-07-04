/**
 * Application configuration schema
 * @typedef {Object} AppConfig
 * @property {string} name - The application name displayed in UI elements and window title
 * @property {string} url - The web URL that the application will load
 * @property {string} iconFile - The filename of the icon used for the application window
 * @property {string} trayIconFile - The filename of the icon used for the application tray
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
 * @property {boolean} notifications - Enable native notifications
 */
const appConfig = require('./app-config.json');

const {app,ipcMain, BrowserWindow, dialog, session} = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');

let setupTray, setupNotifications;

function loadModules() {
  if (!setupTray) setupTray = require('./main/tray').setupTray;
  if (!setupNotifications) setupNotifications = require('./main/notification').setupNotifications;
}

const icon = path.join(__dirname, 'icons', appConfig.iconFile);
const trayIcon = path.join(__dirname, 'icons', appConfig.trayIconFile);


app.name = appConfig.name;
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-zero-copy');
app.commandLine.appendSwitch('disable-software-rasterizer');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder');
  app.commandLine.appendSwitch('ignore-gpu-blacklist');
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
}
app.commandLine.appendSwitch('disable-features', 'InPrivateMode');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('enable-features', 'WebRTC-H264WithOpenH264FFmpeg');

if (process.platform === 'win32') {
  app.setAppUserModelId(appConfig.name);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {

  let mainWindow = null;

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
        extensions: true,
        nodeIntegration: false,
        enableRemoteModule: false,
        contextIsolation: true,
        preload: path.resolve(__dirname, 'preload', 'index.js'),
        autoplayPolicy: 'user-gesture-required',
        partition: 'persist:' + appConfig.snapName,
        enableWebrtc: true,  // Add this line
        webgl: true,        // Add this line
        allowRunningInsecureContent: false,
        webSecurity: true,
        backgroundThrottling: false,
        offscreen: false,
        disableBlinkFeatures: 'Accelerated2dCanvas,AcceleratedSmil'
      },
    });
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        details.requestHeaders['Origin'] = appConfig.url;
        details.requestHeaders['Referer'] = appConfig.url;
        callback({requestHeaders: details.requestHeaders});
      }
    );
    mainWindow.webContents.setUserAgent(appConfig.userAgent);
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      console.log(`Permission requested: ${permission}`);
      const allowedPermissions = appConfig.permissions || [];
      const allowed = allowedPermissions.includes(permission);
      console.log(`Permission ${permission} ${allowed ? 'allowed' : 'denied'}`);
      callback(allowed);
    });

    mainWindow.webContents.on('console-message', (event) => {
      const { message } = event;

      if (message.includes('Uncaught (in promise) AbortError: Registration failed - push service not available')) {
        ipcMain.emit('new-notification', null, {
          title: 'System notifications are inactive',
          body: 'Please switch application notification mode to "Alert" for proper notifications.'
        });
      }
    });
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ['']
        }
      });
    });
    mainWindow.loadURL(appConfig.url, {
      userAgent: appConfig.userAgent,
      httpReferrer: appConfig.url
    }).catch(r => console.error('Error loading URL:', r));
    mainWindow.removeMenu();
    mainWindow.on('focus', () => {
      if (process.platform === 'win32') {
        mainWindow.flashFrame(false);
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      {urls: [appConfig.url + '/*']},
      (details, callback) => {
        details.requestHeaders['Origin'] = appConfig.url;
        details.requestHeaders['Referer'] = appConfig.url;
        callback({requestHeaders: details.requestHeaders});
      }
    );

    mainWindowState.manage(mainWindow);

    if (!appConfig.notifications) {
      console.log('Notifications disabled');
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = appConfig.permissions || [];
        if (permission === 'notifications' || permission === 'push' || allowedPermissions.includes(permission)) {
          callback(true);
        } else {
          callback(false);
        }
      });
    }


    setupExternalLinks(mainWindow);
    setupCloseEvent(mainWindow);
    enableLightPerformanceMode();
    setupDownloadHandler();

    return mainWindow;
  }

  function getOrCreateMainWindow() {
    if (!mainWindow) {
      createWindow();
    }
    return mainWindow;
  }

  function setupDownloadHandler() {
    session.defaultSession.on('will-download', async (event, item) => {
      const fileName = item.getFilename();
      const totalBytes = item.getTotalBytes();

      const {filePath, canceled} = await dialog.showSaveDialog({
        title: 'Save Download',
        defaultPath: path.join(app.getPath('downloads'), fileName)
      });

      if (canceled || !filePath) {
        item.cancel();
        console.log('Download canceled by the user.');
        return;
      }

      item.setSavePath(filePath);
      console.log(`Starting download of ${fileName}`);

      item.on('updated', (event, state) => {
        if (state === 'interrupted') {
          console.log('Download interrupted.');
        } else if (state === 'progressing') {
          console.log(`Progress: ${item.getReceivedBytes()} / ${totalBytes}`);
        }
      });

      item.once('done', (event, state) => {
        if (state === 'completed') {
          console.log(`Download saved to ${filePath}`);
        } else {
          console.error(`Download failed: ${state}`);
        }
      });
    });
  }

  function setupExternalLinks(window) {
    const { shell } = require('electron');

    const openExternalUrl = (url) => {
      shell.openExternal(url).catch(err => console.error('Error loading URL:', err));

      return { action: 'deny' };
    };

    window.webContents.setWindowOpenHandler((details) => {
      const allowedUrls = [
        new URL(appConfig.url).hostname,
        'login.microsoftonline.com',
        'about:blank'
      ];

      const forceNewWindowUrls = [
        'statics.teams.cdn.office.net/evergreen-assets/safelinks'
      ];

      if (forceNewWindowUrls.some(url => details.url.includes(url))) {
        return openExternalUrl(details.url);
      }

      if (allowedUrls.some(url => details.url.includes(url))) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            menuBarVisible: true,
            toolbar: true,
            frame: true,
          }
        };
      }

      if (details.url.startsWith('https://') || details.url.startsWith('http://')) {
        return openExternalUrl(details.url);
      }

      return { action: 'deny' };
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

  app.whenReady().then(async () => {
    await session.defaultSession.clearCache();

    loadModules();
    mainWindow = getOrCreateMainWindow();

    await setupTray(mainWindow, {
      name: appConfig.name,
      iconPath: trayIcon
    });

    setupNotifications(mainWindow, trayIcon);

    setInterval(() => {
      if (global.gc) {
        global.gc();
      }
    }, 60000);

  });

  function enableLightPerformanceMode() {
    // Remove animations, reduce quality of images, etc.
    mainWindow.webContents.executeJavaScript(`
    document.documentElement.style.setProperty('--animation-duration', '0s');
    document.querySelectorAll('img').forEach(img => {
      img.style.imageRendering = 'auto';
    });`).catch(r => console.error('Error executing JS:', r));
  }

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