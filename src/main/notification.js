const {Notification, BrowserWindow} = require('electron');
const {ipcMain} = require('electron');

function setupNotifications(mainWindow, trayIcon) {

  function showAppNotification(title, body) {
    try {

      const notification = new Notification({
        title: title,
        body: body,
        silent: false,
        icon: trayIcon,
        hasReply: false
      });

      notification.on('click', () => {
        console.log('Notification clicked, focusing app window');
        const mainWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          console.log('Window focused successfully');
        } else {
          console.log('No valid window found to focus');
        }
      });

      notification.show();

      console.log('Electron notification shown with click handler');
    } catch (error) {
      console.error('Notification error:', error);
    }
  }

  ipcMain.on('new-notification', (event, data) => {
    console.log('Received notification request:', data);

    showAppNotification(data.title, data.body);
  });

  console.log('Notification event loaded!');
}

module.exports = {setupNotifications};