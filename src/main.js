process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const originalConsole = console.log;
console.log = (...args) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  process.stdout.write(`[MAIN] ${message}\n`);
  originalConsole.apply(console, args);
};

const originalConsoleError = console.error;
console.error = (...args) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  process.stderr.write(`[MAIN-ERROR] ${message}\n`);
  originalConsoleError.apply(console, args);
};

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

const {app, ipcMain, BrowserWindow, dialog, session, globalShortcut, desktopCapturer} = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');
const { StreamSelector } = require('./display-capture');

let setupTray, setupNotifications;

function loadModules() {
  if (!setupTray) setupTray = require('./main/tray').setupTray;
  if (!setupNotifications) setupNotifications = require('./main/notification').setupNotifications;
}

const icon = path.join(__dirname, 'icons', appConfig.iconFile);
const trayIcon = path.join(__dirname, 'icons', appConfig.trayIconFile);


app.name = appConfig.name;

const isSnap = process.env.SNAP && process.env.SNAPCRAFT_PROJECT_NAME;

if (!isSnap) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-rasterization');
  app.commandLine.appendSwitch('disable-zero-copy');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder');
  app.commandLine.appendSwitch('ignore-gpu-blacklist');
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
}

app.commandLine.appendSwitch('disable-features', 'InPrivateMode');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!isSnap) {
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

app.commandLine.appendSwitch('enable-features', 'WebRTC-H264WithOpenH264FFFmpeg');
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
app.commandLine.appendSwitch('enable-webrtc-logs');

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

  function setupZoomControls(window) {

    const zoomIn = () => {
      const currentZoom = window.webContents.getZoomLevel();
      const newZoom = Math.min(currentZoom + 0.5, 3);
      window.webContents.setZoomLevel(newZoom);
      console.log(`Zoom level: ${newZoom}`);
    };

    const zoomOut = () => {
      const currentZoom = window.webContents.getZoomLevel();
      const newZoom = Math.max(currentZoom - 0.5, -3);
      window.webContents.setZoomLevel(newZoom);
      console.log(`Zoom level: ${newZoom}`);
    };

    const resetZoom = () => {
      window.webContents.setZoomLevel(0);
      console.log(`Zoom level reset to: 0`);
    };

    global.resetZoom = resetZoom;

    window.webContents.on('before-input-event', (event, input) => {
      if (input.control || input.meta) {
        switch (input.key) {
          case '=':
          case '+':
            if (input.type === 'keyDown') {
              event.preventDefault();
              zoomIn();
            }
            break;
          case '-':
            if (input.type === 'keyDown') {
              event.preventDefault();
              zoomOut();
            }
            break;
          case '0':
            if (input.type === 'keyDown') {
              event.preventDefault();
              resetZoom();
            }
            break;
        }
      }
    });

    window.webContents.on('zoom-changed', (event, zoomDirection) => {
      const currentZoom = window.webContents.getZoomLevel();
      if (zoomDirection === 'in') {
        const newZoom = Math.min(currentZoom + 0.5, 3);
        window.webContents.setZoomLevel(newZoom);
        console.log(`Mouse zoom in - level: ${newZoom}`);
      } else if (zoomDirection === 'out') {
        const newZoom = Math.max(currentZoom - 0.5, -3);
        window.webContents.setZoomLevel(newZoom);
        console.log(`Mouse zoom out - level: ${newZoom}`);
      }
    });

    window.webContents.once('dom-ready', () => {
      window.webContents.executeJavaScript(`
        document.addEventListener('wheel', (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const zoomDirection = e.deltaY < 0 ? 'in' : 'out';
            window.electron?.zoomChange?.(zoomDirection);
          }
        }, { passive: false });
      `).catch(err => console.log('Error injecting zoom script:', err));
    });

    console.log('Zoom controls setup completed');
  }

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
        preload: path.resolve(__dirname, 'preload', 'index.js'),
        autoplayPolicy: 'user-gesture-required',
        partition: 'persist:' + appConfig.snapName,
        webgl: true,
        allowRunningInsecureContent: false,
        webSecurity: true,
        backgroundThrottling: false,
        offscreen: false,
        zoomFactor: 1.0,
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

      if (permission === 'camera' || permission === 'microphone') {
        console.log(`Permission ${permission} allowed (required for video calls)`);
        callback(true);
        return;
      }

      const allowed = allowedPermissions.includes(permission);
      console.log(`Permission ${permission} ${allowed ? 'allowed' : 'denied'}`);
      callback(allowed);
    });

    console.log('Setting up screen sharing with StreamSelector...');
    const streamSelector = new StreamSelector(mainWindow);
    
    mainWindow.webContents.session.setDisplayMediaRequestHandler(
      (_request, callback) => {
        streamSelector.show((source) => {
          if (source) {
            handleScreenSourceSelection(source, callback);
          } else {
            callback({ video: null, audio: false });
          }
        });
      }
    );

    function handleScreenSourceSelection(source, callback) {
      desktopCapturer
        .getSources({ types: ["window", "screen"] })
        .then((sources) => {
          const selectedSource = findSelectedSource(sources, source);
          if (selectedSource) {
            setupScreenSharing(selectedSource);
            console.log('Screen sharing started with source:', selectedSource.id);
            callback({ video: selectedSource, audio: false });
          } else {
            console.error('Selected source not found in available sources');
            callback({ video: null, audio: false });
          }
        })
        .catch((error) => {
          console.error('Error getting desktop sources:', error);
          callback({ video: null, audio: false });
        });
    }

    function findSelectedSource(sources, source) {
      return sources.find((s) => s.id === source.id);
    }

    function setupScreenSharing(selectedSource) {
      global.selectedScreenShareSource = selectedSource;
      console.log('Screen sharing source selected:', selectedSource.name);
    }


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

    mainWindow.webContents.on('did-finish-load', () => {
      injectScreenSharingLogic();
    });
    mainWindow.removeMenu();
    mainWindow.on('focus', () => {
      if (process.platform === 'win32') {
        mainWindow.flashFrame(false);
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
      globalShortcut.unregisterAll();
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
        
        if (permission === 'camera' || permission === 'microphone') {
          console.log(`Default session permission ${permission} allowed (required for video calls)`);
          callback(true);
          return;
        }
        
        if (permission === 'notifications' || permission === 'push' || allowedPermissions.includes(permission)) {
          callback(true);
        } else {
          callback(false);
        }
      });
    }

    setupZoomControls(mainWindow);
    setupExternalLinks(mainWindow);
    setupCloseEvent(mainWindow);
    if (!isSnap) {
      enableLightPerformanceMode();
    }
    setupDownloadHandler();

    return mainWindow;
  }

  function injectScreenSharingLogic() {
    const fs = require("fs");
    const scriptPath = path.join(__dirname, "display-capture", "screenShare.js");
    try {
      const script = fs.readFileSync(scriptPath, "utf8");
      mainWindow.webContents.executeJavaScript(script).catch(err => console.error('Error injecting screen sharing script:', err));
      console.log('Screen sharing injection script loaded successfully');
    } catch (err) {
      console.error("Failed to load injected screen sharing script:", err);
    }
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
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.microsoft.com https://*.microsoftonline.com https://*.office.com data: blob:;"
          ]
        }
      });
    });

    await session.defaultSession.clearCache();

    ipcMain.handle("desktop-capturer-get-sources", (_event, opts) =>
      desktopCapturer.getSources(opts)
    );

    let picker = null;
    
    ipcMain.handle("choose-desktop-media", async (_event, sourceTypes) => {
      const sources = await desktopCapturer.getSources({ types: sourceTypes });
      const chosen = await showScreenPicker(sources);
      return chosen ? chosen.id : null;
    });

    ipcMain.on("cancel-desktop-media", () => {
      if (picker) {
        picker.close();
      }
    });

    ipcMain.handle("trigger-screen-share", () => {
      console.log('IPC: trigger-screen-share received, showing StreamSelector...');
      const streamSelector = new StreamSelector(mainWindow);
      
      return new Promise((resolve) => {
        streamSelector.show((source) => {
          console.log('StreamSelector returned source:', source);
          if (source) {
            global.selectedScreenShareSource = source;
            console.log('Screen sharing source selected:', source.id);
          }
          resolve(source);
        });
      });
    });

    ipcMain.on("screen-sharing-started", (event, sourceId) => {
      console.log('Screen sharing started with source:', sourceId);
      global.selectedScreenShareSource = sourceId;
    });

    ipcMain.on("screen-sharing-stopped", () => {
      global.selectedScreenShareSource = null;
      console.log('Screen sharing stopped');
    });


    ipcMain.handle("get-screen-sharing-status", () => {
      return global.selectedScreenShareSource !== null;
    });

    ipcMain.handle("get-screen-share-stream", () => {
      if (typeof global.selectedScreenShareSource === "string") {
        return global.selectedScreenShareSource;
      } else if (global.selectedScreenShareSource?.id) {
        return global.selectedScreenShareSource.id;
      }
      return null;
    });

    ipcMain.handle("get-screen-share-screen", () => {
      if (
        global.selectedScreenShareSource &&
        typeof global.selectedScreenShareSource === "object"
      ) {
        const { screen } = require("electron");
        const displays = screen.getAllDisplays();

        if (global.selectedScreenShareSource?.id?.startsWith("screen:")) {
          const display = displays[0] || { size: { width: 1920, height: 1080 } };
          return { width: display.size.width, height: display.size.height };
        }
      }

      return { width: 1920, height: 1080 };
    });

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

  function showScreenPicker(sources) {
    return new Promise((resolve) => {
        let picker = new BrowserWindow({
            width: 800,
            height: 600,
            webPreferences: {
                preload: path.join(__dirname, "source-selector", "preload.js"),
            },
        });

        picker.loadFile(path.join(__dirname, "source-selector", "index.html"));

      picker.webContents.on("did-finish-load", () => {
        picker.webContents.send("sources-list", sources);
      });

      ipcMain.once("source-selected", (event, source) => {
        resolve(source);
        if (picker) {
          picker.close();
        }
      });

      picker.on("closed", () => {
        picker = null;
        resolve(null);
      });
    });
  }

  function enableLightPerformanceMode() {
    mainWindow.webContents.executeJavaScript(`
    document.documentElement.style.setProperty('--animation-duration', '0s');
    document.querySelectorAll('img').forEach(img => {
      img.style.imageRendering = 'auto';
    });`).catch(r => console.error('Error executing JS:', r));
  }

  app.on('window-all-closed', () => {
    globalShortcut.unregisterAll();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}