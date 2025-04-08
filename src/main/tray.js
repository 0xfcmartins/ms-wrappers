const {Tray, Menu, app} = require('electron');

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