/**
 * Sets up the notification system for the application by managing window behavior
 * when a new tab is requested.
 *
 * @param {Object} mainWindow - The main application window object.
 * @return {void} This method does not return a value.
 */
function setupNotifications(mainWindow) {
  mainWindow.webContents.on('new-window-for-tab', () => {
    if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  console.log('Notification system initialized');
}

module.exports = { setupNotifications };