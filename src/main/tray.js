const {Tray, Menu, app} = require('electron');
const fullAppConfig = require('../app-config.json'); // Add this line

async function setupTrayAsync(mainWindow, appConfig) {
  return new Promise((resolve) => {
    const tray = new Tray(appConfig.iconPath);
    tray.setToolTip(appConfig.name || 'Microsoft Teams');

    let keepAliveActive = false;
    let keepAliveIntervalId = null;

    function toggleKeepAlive(enabled) {
      keepAliveActive = enabled;

      if (enabled) {
        if (keepAliveIntervalId) {
          clearInterval(keepAliveIntervalId);
        }

        keepAliveIntervalId = setInterval(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.executeJavaScript(`
              const event = new MouseEvent("mousemove", {
                bubbles: true,
                cancelable: true,
                view: window
              });
              window.dispatchEvent(event);
              console.log("[Keep-alive] Mouse movement simulated at " + new Date().toLocaleTimeString());
            `).catch(err => {
              console.error('Error in keep-alive script:', err);
            });
          }
        }, 10000);

        console.log('Keep Teams Active feature enabled');
        updateTrayMenu();
      } else if (keepAliveIntervalId) {
          clearInterval(keepAliveIntervalId);
          keepAliveIntervalId = null;
          console.log('Keep Teams Active feature disabled');
          updateTrayMenu();
      }
    }

    function updateTrayMenu() {
      const updatedTemplate = [
        {label: 'Show App', click: () => mainWindow.show()},
        {label: 'Show Developer Tools', click: () => mainWindow.webContents.openDevTools({mode: 'detach'})},
        {label: 'Force Reload', click: () => mainWindow.reload()},
        {label: 'Minimize to Tray', click: () => mainWindow.hide()},
        {type: 'separator'}
      ];

      // Only add "Keep Teams Active" if snapName is "teams-ew"
      if (fullAppConfig.snapName === 'teams-ew') {  // Use fullAppConfig instead
        updatedTemplate.push({
          label: 'Keep Teams Active',
          type: 'checkbox',
          checked: keepAliveActive,
          click: (menuItem) => {
            toggleKeepAlive(menuItem.checked);
          }
        });
      }

      updatedTemplate.push(
        {
          label: 'Reset Zoom',
          click: () => {
            mainWindow.webContents.setZoomLevel(0);
            console.log(`Tray zoom reset - Zoom level: 0`);
          }
        },
        {type: 'separator'},
        {
          label: 'Quit', click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      );

      const updatedMenu = Menu.buildFromTemplate(updatedTemplate);
      tray.setContextMenu(updatedMenu);
    }

    // Initial menu setup
    updateTrayMenu();

    tray.on('click', () => {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();

        if (process.platform === 'win32') {
          mainWindow.flashFrame(false);
        }
      }
    });

    // Clean up the interval when the app is quitting
    app.on('before-quit', () => {
      if (keepAliveIntervalId) {
        clearInterval(keepAliveIntervalId);
      }
    });

    resolve(tray);
  });
}

module.exports = {setupTray: setupTrayAsync};