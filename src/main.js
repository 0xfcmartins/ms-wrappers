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
const { validateIpcChannel, allowedChannels } = require('./security/ipcValidator');
const { StreamSelector } = require('./display-capture');
const previewWindow = require('./preview');

// IPC Security: Add validation wrappers for all IPC handlers
const originalIpcHandle = ipcMain.handle.bind(ipcMain);
const originalIpcOn = ipcMain.on.bind(ipcMain);

ipcMain.handle = (channel, handler) => {
  return originalIpcHandle(channel, (event, ...args) => {
    if (!validateIpcChannel(channel, args.length > 0 ? args[0] : null)) {
      console.error(`[IPC Security] Rejected handle request for channel: ${channel}`);
      return Promise.reject(new Error(`Unauthorized IPC channel: ${channel}`));
    }
    return handler(event, ...args);
  });
};

ipcMain.on = (channel, handler) => {
  return originalIpcOn(channel, (event, ...args) => {
    if (!validateIpcChannel(channel, args.length > 0 ? args[0] : null)) {
      console.error(`[IPC Security] Rejected event for channel: ${channel}`);
      return;
    }
    return handler(event, ...args);
  });
};

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

// Environment-aware media flags - Wayland-specific optimization for Linux desktop environments
// PipeWire provides better screen sharing and audio capture on Wayland
if (process.env.XDG_SESSION_TYPE === 'wayland') {
  console.info('Running under Wayland, enabling PipeWire support...');
  
  const features = app.commandLine.hasSwitch('enable-features')
    ? app.commandLine.getSwitchValue('enable-features').split(',')
    : ['WebRTC-H264WithOpenH264FFFmpeg'];
  
  if (!features.includes('WebRTCPipeWireCapturer')) {
    features.push('WebRTCPipeWireCapturer');
  }
  
  app.commandLine.appendSwitch('enable-features', features.join(','));
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
} else {
  // Non-Wayland environments: enable H264 support only
  app.commandLine.appendSwitch('enable-features', 'WebRTC-H264WithOpenH264FFFmpeg');
}

// WebRTC logs only in development mode
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('enable-webrtc-logs');
}

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

    // Set up unified screen sharing with StreamSelector as primary path
    console.log('[ScreenShare] Setting up StreamSelector for screen sharing...');
    const streamSelector = new StreamSelector(mainWindow);
    
    mainWindow.webContents.session.setDisplayMediaRequestHandler(
      (_request, callback) => {
        console.log('[ScreenShare] Display media request received');
        
        streamSelector.show((selectedSource) => {
          if (selectedSource) {
            console.log(`[ScreenShare] Source selected: ${selectedSource.name} (${selectedSource.id})`);
            // Set up screen sharing state
            global.selectedScreenShareSource = selectedSource;
            
            // Create and show preview window after successful selection
            previewWindow.create(selectedSource);
            
            // Use proper audio parameter format per Electron: 'loopback' captures system audio
            callback({ video: selectedSource, audio: 'loopback' });
          } else {
            console.log('[ScreenShare] Selection cancelled or failed');
            // Proper cancellation format: empty object
            callback({});
          }
        });
      }
    );

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

    // Log allowlisted IPC channels count for security audit
    console.log(`[IPC Security] Initialized with ${allowedChannels.size} allowlisted channels`);

    // IPC Handlers for screen sharing and preview management
    setupScreenSharingIpcHandlers();

    // Request media access early on macOS to avoid mid-call prompts
    if (process.platform === 'darwin') {
      requestMediaAccess();
    }

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
    mainWindow.webContents.executeJavaScript(`
    document.documentElement.style.setProperty('--animation-duration', '0s');
    document.querySelectorAll('img').forEach(img => {
      img.style.imageRendering = 'auto';
    });`).catch(r => console.error('Error executing JS:', r));
  }

  // Screen sharing and preview IPC handlers
  function setupScreenSharingIpcHandlers() {
    // Handle trigger screen sharing from renderer process API
    ipcMain.on("trigger-screen-share", () => {
      console.log('[ScreenShare] Screen sharing triggered from renderer API');
      
      if (!mainWindow || mainWindow.isDestroyed()) {
        console.error('[ScreenShare] Main window not available');
        return;
      }

      // Use the same StreamSelector flow as setDisplayMediaRequestHandler
      const { StreamSelector } = require('./display-capture');
      const streamSelector = new StreamSelector(mainWindow);
      
      streamSelector.show((selectedSource) => {
        if (selectedSource) {
          console.log(`[ScreenShare] Source selected via API: ${selectedSource.name} (${selectedSource.id})`);
          // Set up screen sharing state
          global.selectedScreenShareSource = selectedSource;
          
          // Create and show preview window
          previewWindow.create(selectedSource);
          
          // Notify renderer of successful start
          mainWindow.webContents.send("screen-sharing-status-changed", { isActive: true });
        } else {
          console.log('[ScreenShare] Selection cancelled via API');
          // Notify renderer of cancelled selection
          mainWindow.webContents.send("screen-sharing-status-changed", { isActive: false });
        }
      });
    });

    // Handle screen sharing stopped - clear state and close preview
    ipcMain.on("screen-sharing-stopped", () => {
      console.log('[ScreenShare] Screen sharing stopped');
      global.selectedScreenShareSource = null;

      // Close preview window when screen sharing stops
      if (previewWindow.isOpen()) {
        previewWindow.updateStatus(false);
        previewWindow.close();
      }
    });

    // Handle preview window resize requests with constraints
    ipcMain.on("resize-preview-window", (event, { width, height }) => {
      console.log(`[ScreenShare] Preview resize requested: ${width}x${height}`);
      if (previewWindow.isOpen()) {
        previewWindow.resize(width, height);
      }
    });

    // Handle stop screen sharing from preview thumbnail
    ipcMain.on("stop-screen-sharing-from-thumbnail", () => {
      console.log('[ScreenShare] Stop screen sharing requested from preview');
      global.selectedScreenShareSource = null;
      
      // Update preview status and close
      if (previewWindow.isOpen()) {
        previewWindow.updateStatus(false);
      }
      
      // Notify renderer process of status change
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screen-sharing-status-changed", { isActive: false });
      }
    });

    // Handle minimize preview window
    ipcMain.on("minimize-preview-window", () => {
      console.log('[ScreenShare] Preview minimize requested');
      if (previewWindow.isOpen()) {
        previewWindow.hide();
      }
    });

    // Status and stream handlers for compatibility
    ipcMain.handle("get-screen-sharing-status", () => {
      const isActive = global.selectedScreenShareSource !== null;
      console.log(`[ScreenShare] Status requested: ${isActive}`);
      return isActive;
    });

    ipcMain.handle("get-screen-share-stream", async () => {
      // Return the source ID - handle both string and object formats
      if (typeof global.selectedScreenShareSource === "string") {
        return global.selectedScreenShareSource;
      } else if (global.selectedScreenShareSource?.id) {
        // Validate that the source still exists (handle display changes)
        try {
          const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
          const sourceExists = sources.find(s => s.id === global.selectedScreenShareSource.id);
          
          if (!sourceExists) {
            console.warn('[ScreenShare] Selected source no longer available, clearing state');
            global.selectedScreenShareSource = null;
            
            // Close preview window if source is no longer available
            if (previewWindow.isOpen()) {
              previewWindow.updateStatus(false);
              previewWindow.close();
            }
            
            return null;
          }
        } catch (error) {
          console.error('[ScreenShare] Error validating source:', error);
          return global.selectedScreenShareSource.id;
        }
        
        return global.selectedScreenShareSource.id;
      }
      console.log('[ScreenShare] No active screen share stream');
      return null;
    });

    ipcMain.handle("get-screen-share-screen", () => {
      // Return screen dimensions if available, otherwise default
      if (
        global.selectedScreenShareSource &&
        typeof global.selectedScreenShareSource === "object"
      ) {
        const { screen } = require("electron");
        const displays = screen.getAllDisplays();

        if (global.selectedScreenShareSource?.id?.startsWith("screen:")) {
          const display = displays[0] || { size: { width: 1920, height: 1080 } };
          console.log(`[ScreenShare] Screen dimensions: ${display.size.width}x${display.size.height}`);
          return { width: display.size.width, height: display.size.height };
        }
      }

      console.log('[ScreenShare] Using default screen dimensions');
      return { width: 1920, height: 1080 };
    });

    // Legacy compatibility handlers for desktop capture
    ipcMain.handle("desktop-capturer-get-sources", (_event, opts) => {
      console.log('[ScreenShare] Desktop capturer sources requested');
      return desktopCapturer.getSources(opts);
    });

    console.log('[ScreenShare] IPC handlers initialized');
  }

  // macOS media permissions handler
  async function requestMediaAccess() {
    if (process.platform !== 'darwin') {
      return;
    }

    const { systemPreferences } = require('electron');
    
    ['camera', 'microphone'].forEach(async (permission) => {
      try {
        const status = await systemPreferences.askForMediaAccess(permission);
        console.log(`[macOS Permissions] ${permission} access status: ${status}`);
      } catch (error) {
        console.error(`[macOS Permissions] Error requesting ${permission} access:`, error);
      }
    });
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