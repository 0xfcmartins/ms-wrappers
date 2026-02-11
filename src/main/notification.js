const {Notification, ipcMain, nativeImage} = require('electron');
const path = require('path');

function setupNotifications(mainWindow, iconPath) {

  function showAppNotification(title, body) {
    try {
      const notificationIcon = iconPath ? nativeImage.createFromPath(iconPath) : null;

      const notification = new Notification({
        title: title,
        body: body,
        silent: false,
        icon: notificationIcon,
        hasReply: false
      });

      notification.on('click', () => {
        console.log('Notification clicked, focusing app window');
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          console.log('Window focused successfully');
        } else {
          console.log('No valid window found to focus');
        }
      });
      
      notification.show();

      setTimeout(() => {
        notification.close();
      }, 10000);

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