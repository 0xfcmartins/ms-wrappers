const {Notification, BrowserWindow} = require('electron');
const notifier = require('node-notifier');
const {ipcMain} = require('electron');


/**
 * Initializes the notification system for the main application window and tray icon.
 * Sets up event listeners and a method to display app-specific notifications.
 *
 * @param {BrowserWindow} mainWindow - The main application window instance.
 * @param {string} trayIcon - The file path or URL of the tray icon to use in notifications.
 * @return {void} Does not return a value.
 */
function setupNotifications(mainWindow, trayIcon) {

  function showAppNotification(title, body) {
    try {
      const { Notification } = require('electron');
      const notification = new Notification({
        title: title,
        body: body,
        silent: false,
        icon: trayIcon
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