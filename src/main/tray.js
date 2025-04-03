const {Tray, Menu, app} = require('electron');

/**
 * Sets up the system tray with a custom icon, menu, and click behavior for the application.
 *
 * @param {BrowserWindow} mainWindow - The main window of the application, used to control visibility and functionality.
 * @param appConfig - Application config
 * @return {Electron.CrossProcessExports.Tray} - The created Tray instance configured with icon, context menu, and click
 * behavior.
 */
async function setupTrayAsync(mainWindow, appConfig) {
  return new Promise((resolve) => {
    const tray = new Tray(appConfig.iconPath);
    tray.setToolTip(appConfig.name || 'Microsoft Teams');

    const contextMenu = Menu.buildFromTemplate([
      {label: 'Show App', click: () => mainWindow.show()},
      {label: 'Minimize to Tray', click: () => mainWindow.hide()},
      {type: 'separator'},
      {
        label: 'Quit', click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);

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

    resolve(tray);
  });
}

module.exports = {setupTray: setupTrayAsync};