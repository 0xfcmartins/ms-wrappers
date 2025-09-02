/**
 * Keep Alive Module
 * Handles the keep-alive functionality to prevent Teams from going idle
 */

// Configuration constants
const KEEP_ALIVE_CONFIG = {
  INTERVAL_MS: 10000, // 10 seconds
  LOG_PREFIX: '[Keep-alive]'
};

/**
 * Creates the keep-alive simulation script
 * @returns {string} The JavaScript code to simulate mouse movement
 */
function createKeepAliveScript() {
  return `
    const event = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      view: window
    });
    window.dispatchEvent(event);
    console.log("${KEEP_ALIVE_CONFIG.LOG_PREFIX} Mouse movement simulated at " + new Date().toLocaleTimeString());
  `;
}

/**
 * Starts the keep-alive interval
 * @param {BrowserWindow} mainWindow - The main application window
 * @returns {NodeJS.Timeout} The interval ID
 */
function startKeepAliveInterval(mainWindow) {
  return setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(createKeepAliveScript())
        .catch(err => {
          console.error('Error in keep-alive script:', err);
        });
    }
  }, KEEP_ALIVE_CONFIG.INTERVAL_MS);
}

/**
 * Toggles the keep-alive feature on or off
 * @param {boolean} enabled - Whether to enable keep-alive
 * @param {Object} state - State object containing keepAliveActive and keepAliveIntervalId
 * @param {BrowserWindow} mainWindow - The main application window
 * @param {Function} updateMenuCallback - Callback to update the tray menu
 */
function toggleKeepAlive(enabled, state, mainWindow, updateMenuCallback) {
  state.keepAliveActive = enabled;

  if (enabled) {
    if (state.keepAliveIntervalId) {
      clearInterval(state.keepAliveIntervalId);
    }

    state.keepAliveIntervalId = startKeepAliveInterval(mainWindow);
    console.log('Keep Teams Active feature enabled');
    updateMenuCallback();
  } else if (state.keepAliveIntervalId) {
    clearInterval(state.keepAliveIntervalId);
    state.keepAliveIntervalId = null;
    console.log('Keep Teams Active feature disabled');
    updateMenuCallback();
  }
}

/**
 * Creates the keep-alive menu item
 * @param {Object} state - State object containing keepAliveActive
 * @param {BrowserWindow} mainWindow - The main application window
 * @param {Function} updateMenuCallback - Callback to update the tray menu
 * @returns {Object} Menu item object
 */
function createKeepAliveMenuItem(state, mainWindow, updateMenuCallback) {
  return {
    label: 'Keep Teams Active',
    type: 'checkbox',
    checked: state.keepAliveActive,
    click: (menuItem) => {
      toggleKeepAlive(menuItem.checked, state, mainWindow, updateMenuCallback);
    }
  };
}

/**
 * Cleans up keep-alive resources
 * @param {Object} state - State object containing keepAliveIntervalId
 */
function cleanupKeepAlive(state) {
  if (state.keepAliveIntervalId) {
    clearInterval(state.keepAliveIntervalId);
    state.keepAliveIntervalId = null;
  }
}

module.exports = {
  createKeepAliveMenuItem,
  cleanupKeepAlive
};