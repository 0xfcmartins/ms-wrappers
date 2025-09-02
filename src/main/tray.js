const { Tray, Menu, app, ipcMain } = require('electron');
const fullAppConfig = require('../app-config.json');
const { activateCameraPermissions, executeSnapCommands, showActivationResult } = require('./camera-activation');
const { createKeepAliveMenuItem, cleanupKeepAlive } = require('./keep-alive');

/**
 * Tray Management Module
 * Handles system tray setup, menu creation, and event handling
 */

// Menu configuration constants
const MENU_LABELS = {
  SHOW_APP: 'Show App',
  SHOW_DEV_TOOLS: 'Show Developer Tools',
  FORCE_RELOAD: 'Force Reload',
  MINIMIZE_TO_TRAY: 'Minimize to Tray',
  ACTIVATE_CAMERA: 'Activate Camera',
  RESET_ZOOM: 'Reset Zoom',
  QUIT: 'Quit'
};

// IPC channel constants
const IPC_CHANNELS = {
  CAMERA_ACTIVATION: 'proceed-camera-activation'
};

/**
 * Creates the base menu template with common items
 * @param {BrowserWindow} mainWindow - The main application window
 * @returns {Array} Base menu template array
 */
function createBaseMenuTemplate(mainWindow) {
  return [
    { label: MENU_LABELS.SHOW_APP, click: () => mainWindow.show() },
    { label: MENU_LABELS.SHOW_DEV_TOOLS, click: () => mainWindow.webContents.openDevTools({ mode: 'detach' }) },
    { label: MENU_LABELS.FORCE_RELOAD, click: () => mainWindow.reload() },
    { label: MENU_LABELS.MINIMIZE_TO_TRAY, click: () => mainWindow.hide() },
    { type: 'separator' }
  ];
}

/**
 * Creates the camera activation menu item
 * @param {BrowserWindow} mainWindow - The main application window
 * @returns {Object} Menu item object
 */
function createCameraMenuItem(mainWindow) {
  return {
    label: MENU_LABELS.ACTIVATE_CAMERA,
    click: () => activateCameraPermissions(mainWindow)
  };
}

/**
 * Creates the end menu template items (zoom reset and quit)
 * @param {BrowserWindow} mainWindow - The main application window
 * @returns {Array} End menu template items
 */
function createEndMenuTemplate(mainWindow) {
  return [
    {
      label: MENU_LABELS.RESET_ZOOM,
      click: () => {
        mainWindow.webContents.setZoomLevel(0);
        console.log('Tray zoom reset - Zoom level: 0');
      }
    },
    { type: 'separator' },
    {
      label: MENU_LABELS.QUIT,
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ];
}

/**
 * Builds the complete tray menu based on app configuration
 * @param {import('electron').Tray} tray - The tray instance
 * @param {import('electron').BrowserWindow} mainWindow - The main application window
 * @param {Object} state - State object containing keepAliveActive
 * @param {Function} updateMenuCallback - Self-reference for recursive calls
 */
function buildTrayMenu(tray, mainWindow, state, updateMenuCallback) {
  const menuTemplate = createBaseMenuTemplate(mainWindow);

  // Add teams-ew specific features if this is the teams-ew snap
  if (fullAppConfig.snapName === 'teams-ew') {
    menuTemplate.push(createKeepAliveMenuItem(state, mainWindow, updateMenuCallback));
    menuTemplate.push(createCameraMenuItem(mainWindow));
  }

  menuTemplate.push(...createEndMenuTemplate(mainWindow));

  const menu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(menu);
}

/**
 * Handles tray click events to show/hide the main window
 * @param {BrowserWindow} mainWindow - The main application window
 */
function handleTrayClick(mainWindow) {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    // Flash frame on Windows to get user attention
    if (process.platform === 'win32') {
      mainWindow.flashFrame(false);
    }
  }
}

/**
 * Sets up IPC handlers for camera activation
 * @param {BrowserWindow} mainWindow - The main application window
 * @returns {Function} Cleanup function to remove handlers
 */
function setupIpcHandlers(mainWindow) {
  const handleCameraActivation = () => {
    console.log('Received camera activation confirmation from dialog');
    // Execute snap commands directly to avoid infinite loop
    executeSnapCommands(mainWindow, showActivationResult);
  };
  
  ipcMain.on(IPC_CHANNELS.CAMERA_ACTIVATION, handleCameraActivation);
  
  // Return cleanup function
  return () => {
    ipcMain.removeListener(IPC_CHANNELS.CAMERA_ACTIVATION, handleCameraActivation);
  };
}

/**
 * Sets up the system tray with all necessary functionality
 * @param {import('electron').BrowserWindow} mainWindow - The main application window
 * @param {Object} appConfig - Application configuration object
 * @returns {Promise<import('electron').Tray>} Promise that resolves to the tray instance
 */
async function setupTrayAsync(mainWindow, appConfig) {
  return new Promise((resolve) => {
    // Initialize tray
    const tray = new Tray(appConfig.iconPath);
    tray.setToolTip(appConfig.name || 'Microsoft Teams');

    // Initialize state
    const state = {
      keepAliveActive: false,
      keepAliveIntervalId: null
    };

    // Create menu update callback with self-reference
    const updateMenuCallback = () => buildTrayMenu(tray, mainWindow, state, updateMenuCallback);

    // Set up IPC handlers and get cleanup function
    const cleanupIpc = setupIpcHandlers(mainWindow);

    // Set up unified cleanup on app quit
    app.on('before-quit', () => {
      cleanupIpc();
      cleanupKeepAlive(state);
    });

    // Build initial menu
    updateMenuCallback();

    // Set up tray click handler
    tray.on('click', () => handleTrayClick(mainWindow));

    resolve(tray);
  });
}

module.exports = {setupTray: setupTrayAsync};