process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const {setupLogging} = require('./main/logging');
setupLogging();

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

const {app, ipcMain, BrowserWindow, dialog, session, globalShortcut, desktopCapturer, net, Menu} = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');
const {validateIpcChannel, allowedChannels} = require('./security/ipcValidator');
const screenShare = require('./main/screenShare');
const {applyEnvironment} = require('./main/environment');

// Enhanced error handling
function setupGlobalErrorHandling() {
    process.on('uncaughtException', (error) => {
        console.error('[FATAL] Uncaught Exception:', error);
        dialog.showErrorBox('Fatal Error', 'Application encountered a fatal error and will restart.');
        app.relaunch();
        app.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('[ERROR] Unhandled Promise Rejection at:', promise, 'reason:', reason);
    });
}

// Configuration validation
function validateAppConfig(config) {
    const required = ['name', 'url', 'iconFile', 'windowOptions'];
    const missing = required.filter(key => !config[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required config keys: ${missing.join(', ')}`);
    }

    try {
        new URL(config.url);
    } catch {
        throw new Error(`Invalid URL in config: ${config.url}`);
    }

    const { windowOptions } = config;
    if (windowOptions.width < 400 || windowOptions.height < 300) {
        console.warn('[Config] Window dimensions may be too small for proper functionality');
    }

    console.log('[Config] Configuration validated successfully');
}

// Enhanced IPC security with rate limiting
class IPCRateLimiter {
    constructor() {
        this.requests = new Map();
        this.windowLimit = 100;
        this.windowMs = 60000;
    }

    isAllowed(senderId, channel) {
        const now = Date.now();
        const key = `${senderId}-${channel}`;

        if (!this.requests.has(key)) {
            this.requests.set(key, { count: 1, resetTime: now + this.windowMs });
            return true;
        }

        const record = this.requests.get(key);

        if (now > record.resetTime) {
            record.count = 1;
            record.resetTime = now + this.windowMs;
            return true;
        }

        if (record.count >= this.windowLimit) {
            console.warn(`[IPC Security] Rate limit exceeded for ${key}`);
            return false;
        }

        record.count++;
        return true;
    }
}

const ipcRateLimiter = new IPCRateLimiter();

// IPC Security: Add validation wrappers for all IPC handlers
const originalIpcHandle = ipcMain.handle.bind(ipcMain);
const originalIpcOn = ipcMain.on.bind(ipcMain);

ipcMain.handle = (channel, handler) => {
    return originalIpcHandle(channel, (event, ...args) => {
        const senderId = event.sender.id;

        if (!ipcRateLimiter.isAllowed(senderId, channel)) {
            return Promise.reject(new Error('Rate limit exceeded'));
        }

        if (!validateIpcChannel(channel, args.length > 0 ? args[0] : null)) {
            console.error(`[IPC Security] Rejected handle request for channel: ${channel}`);
            return Promise.reject(new Error(`Unauthorized IPC channel: ${channel}`));
        }
        return handler(event, ...args);
    });
};

ipcMain.on = (channel, handler) => {
    return originalIpcOn(channel, (event, ...args) => {
        const senderId = event.sender.id;

        if (!ipcRateLimiter.isAllowed(senderId, channel)) {
            console.warn(`[IPC Security] Rate limited event for channel: ${channel}`);
            return;
        }

        if (!validateIpcChannel(channel, args.length > 0 ? args[0] : null)) {
            console.error(`[IPC Security] Rejected event for channel: ${channel}`);
            return;
        }
        return handler(event, ...args);
    });
};

// Enhanced memory management
function setupEnhancedMemoryManagement() {
    const monitorMemory = () => {
        const usage = process.memoryUsage();
        const mbUsage = {
            rss: Math.round(usage.rss / 1024 / 1024),
            heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
            heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
            external: Math.round(usage.external / 1024 / 1024)
        };

        console.log(`[Memory] RSS: ${mbUsage.rss}MB, Heap: ${mbUsage.heapUsed}/${mbUsage.heapTotal}MB`);

        if (mbUsage.heapUsed > 500 && global.gc) {
            console.log('[Memory] High memory usage detected, triggering GC');
            global.gc();
        }

        if (mbUsage.rss > 1000) {
            console.warn('[Memory] High RSS memory usage detected:', mbUsage.rss, 'MB');
        }
    };

    setInterval(monitorMemory, 120000);
}

// Network connectivity monitoring
function setupNetworkMonitoring(window) {
    const checkConnectivity = async () => {
        try {
            const request = net.request(appConfig.url);
            return new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(false), 5000);
                request.on('response', () => {
                    clearTimeout(timeout);
                    resolve(true);
                });
                request.on('error', () => {
                    clearTimeout(timeout);
                    resolve(false);
                });
                request.end();
            });
        } catch {
            return false;
        }
    };

    setInterval(async () => {
        const isOnline = await checkConnectivity();
        if (window && !window.isDestroyed()) {
            window.webContents.send('connectivity-status', { isOnline });
        }
    }, 30000);
}

let setupTray, setupNotifications;

function loadModules() {
    if (!setupTray) setupTray = require('./main/tray').setupTray;
    if (!setupNotifications) setupNotifications = require('./main/notification').setupNotifications;
}

const icon = path.join(__dirname, 'icons', appConfig.iconFile);
const trayIcon = path.join(__dirname, 'icons', appConfig.trayIconFile);

// Fix for shared memory issues in sandboxed Linux environments.
// This is a common problem in containers or with some Snap configurations.
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('no-zygote');
}

app.name = appConfig.name;

const {isSnap} = applyEnvironment(app, appConfig);

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
        try {
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
                    plugins: true, // Enable plugin support for Widevine DRM
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

            if (app.name === 'teams-ew') {
                // Set up screen sharing via extracted module
                screenShare.init(mainWindow);
            }

            mainWindow.webContents.on('console-message', (event) => {
                const {message} = event;

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
                console.log('[Window] Main window loaded successfully');
            });

            mainWindow.removeMenu();

            // Setup context menu for editable fields and selections to support right-click across devices
            mainWindow.webContents.on('context-menu', (event, params) => {
                const { isEditable, selectionText, misspelledWord, dictionarySuggestions } = params;
                const template = [];

                // Spelling suggestions
                if (misspelledWord && Array.isArray(dictionarySuggestions) && dictionarySuggestions.length) {
                    for (const suggestion of dictionarySuggestions.slice(0, 6)) {
                        template.push({
                            label: suggestion,
                            click: () => mainWindow.webContents.replaceMisspelling(suggestion),
                        });
                    }
                    template.push({ type: 'separator' });
                }

                if (isEditable) {
                    template.push(
                        { role: 'undo' },
                        { role: 'redo' },
                        { type: 'separator' },
                        { role: 'cut' },
                        { role: 'copy' },
                        { role: 'paste' },
                        { role: 'pasteAndMatchStyle' },
                        { type: 'separator' },
                        { role: 'selectAll' },
                    );
                } else if (selectionText && selectionText.trim().length > 0) {
                    template.push(
                        { role: 'copy' },
                        { type: 'separator' },
                        { role: 'selectAll' },
                    );
                } else {
                    // No relevant action — do not show menu
                    return;
                }

                const menu = Menu.buildFromTemplate(template);
                menu.popup({ window: mainWindow });
            });

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
            setupNetworkMonitoring(mainWindow);

            if (!isSnap) {
                enableLightPerformanceMode();
            }
            setupDownloadHandler();

            return mainWindow;

        } catch (error) {
            console.error('[Window] Failed to create window:', error);

            // Fallback window creation
            const fallbackWindow = new BrowserWindow({
                width: 1200,
                height: 800,
                icon: icon,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: true,
                }
            });

            fallbackWindow.loadURL(appConfig.url);
            console.log('[Window] Created fallback window');
            return fallbackWindow;
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
        const {shell} = require('electron');

        const openExternalUrl = (url) => {
            shell.openExternal(url).catch(err => console.error('Error loading URL:', err));
            return {action: 'deny'};
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

    app.whenReady().then(async () => {
        try {
            // Setup error handling first
            setupGlobalErrorHandling();

            // Validate configuration
            validateAppConfig(appConfig);

            // Setup enhanced memory management
            setupEnhancedMemoryManagement();

            // Enhanced security headers
            session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
                callback({
                    responseHeaders: {
                        ...details.responseHeaders,
                        'Content-Security-Policy': [
                            "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.microsoft.com https://*.microsoftonline.com https://*.office.com data: blob:; " +
                            "frame-ancestors 'none'; " +
                            "base-uri 'self';"
                        ],
                        'X-Frame-Options': ['DENY'],
                        'X-Content-Type-Options': ['nosniff']
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

            console.log('[App] Application initialized successfully');

        } catch (error) {
            console.error('[App] Failed to initialize application:', error);
            app.quit();
        }
    });

    function enableLightPerformanceMode() {
        mainWindow.webContents.executeJavaScript(`
    document.documentElement.style.setProperty('--animation-duration', '0s');
    document.querySelectorAll('img').forEach(img => {
      img.style.imageRendering = 'auto';
    });`).catch(r => console.error('Error executing JS:', r));
    }

    // Enhanced screen sharing IPC handlers with error handling
    function setupScreenSharingIpcHandlers() {
        // Enhanced desktop capturer with error handling
        ipcMain.handle("get-screen-sources-safe", async () => {
            try {
                const sources = await desktopCapturer.getSources({
                    types: ['window', 'screen'],
                    thumbnailSize: { width: 300, height: 300 },
                    fetchWindowIcons: true
                });

                // Filter out system windows that might cause issues
                const filteredSources = sources.filter(source => {
                    return !source.name.includes('loginwindow') &&
                        !source.name.includes('WindowServer') &&
                        source.name.trim().length > 0;
                });

                return filteredSources.map(source => ({
                    id: source.id,
                    name: source.name,
                    thumbnail: source.thumbnail.toDataURL()
                }));
            } catch (error) {
                console.error('[ScreenShare] Error getting sources:', error);
                return [];
            }
        });

        // Handle trigger screen sharing from renderer process API
        ipcMain.on("trigger-screen-share", () => {
            console.log('[ScreenShare] Screen sharing triggered from renderer API');

            if (!mainWindow || mainWindow.isDestroyed()) {
                console.error('[ScreenShare] Main window not available');
                return;
            }

            // Use StreamSelector for source selection
            streamSelector.show((selectedSource) => {
                if (selectedSource) {
                    console.log(`[ScreenShare] Source selected via API: ${selectedSource.name} (${selectedSource.id})`);
                    // Set up screen sharing state
                    global.selectedScreenShareSource = selectedSource;

                    // Send the selected source back to renderer for Teams to use
                    mainWindow.webContents.send("screen-sharing-source-selected", {
                        sourceId: selectedSource.id,
                        sourceName: selectedSource.name,
                        isActive: true
                    });
                } else {
                    console.log('[ScreenShare] Selection cancelled via API');
                    // Notify renderer of cancelled selection - this won't interfere with camera
                    mainWindow.webContents.send("screen-sharing-source-selected", {
                        isActive: false,
                        cancelled: true
                    });
                }
            });
        });

        // Handle screen sharing stopped - clear state
        ipcMain.on("screen-sharing-stopped", () => {
            console.log('[ScreenShare] Screen sharing stopped');
            global.selectedScreenShareSource = null;

            if (previewWindow) {
                previewWindow.close();
            }

            // Notify renderer process of status change
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("screen-sharing-status-changed", {isActive: false});
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
                    const sources = await desktopCapturer.getSources({types: ['window', 'screen']});
                    const sourceExists = sources.find(s => s.id === global.selectedScreenShareSource.id);

                    if (!sourceExists) {
                        console.warn('[ScreenShare] Selected source no longer available, clearing state');
                        global.selectedScreenShareSource = null;
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
                const {screen} = require("electron");
                const displays = screen.getAllDisplays();

                if (global.selectedScreenShareSource?.id?.startsWith("screen:")) {
                    const display = displays[0] || {size: {width: 1920, height: 1080}};
                    console.log(`[ScreenShare] Screen dimensions: ${display.size.width}x${display.size.height}`);
                    return {width: display.size.width, height: display.size.height};
                }
            }

            console.log('[ScreenShare] Using default screen dimensions');
            return {width: 1920, height: 1080};
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

        const {systemPreferences} = require('electron');

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