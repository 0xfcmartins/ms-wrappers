const {app, BrowserWindow, Notification, ipcMain, Tray, Menu, shell} = require("electron");
const path = require("path");
require("electron-tray-window");

let mainWindow;
let tray = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {

    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
        }
    });

    function updateTray(count) {

        if (!tray) return;

        if (count > 0) {
            tray.setToolTip(`Microsoft Teams (${count} unread)`);

            if (process.platform === 'darwin') {
                tray.setTitle(`${count}`);
            }

        } else {
            tray.setToolTip('Microsoft Teams');
            if (process.platform === 'darwin') {
                tray.setTitle('');
            }
        }

        if (process.platform === 'darwin') {
            app.dock.setBadge(count > 0 ? count.toString() : '');
        }

        if (process.platform === 'win32' && count > 0 && !mainWindow.isFocused()) {
            mainWindow.flashFrame(true);
        }
    }

    app.whenReady().then(() => {
        mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                sandbox: false,
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, "preload.js"),
                autoplayPolicy: 'user-gesture-required',
                enableWebAudio: true
            },
        });
        mainWindow.removeMenu();

        mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
            // List of permissions you want to allow
            const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications', 'midi', 'midiSysex'];

            if (allowedPermissions.includes(permission)) {
                // Grant permission
                return callback(true);
            }

            // Deny permission
            return callback(false);
        });

        mainWindow.webContents.setUserAgent(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        mainWindow.loadURL("https://teams.microsoft.com").then(r => console.log(r));

        mainWindow.webContents.setWindowOpenHandler(({url}) => {
            // noinspection HttpUrlsUsage
            if (url.startsWith('https://') || url.startsWith('http://')) {
                shell.openExternal(url).then(r => console.log(r));
            }
            return {action: 'deny'};
        });

        mainWindow.webContents.on('will-navigate', (event, url) => {
            const currentURL = mainWindow.webContents.getURL();

            // If the target URL is different from your app URL, open externally.
            if (url !== currentURL) {
                event.preventDefault();
                shell.openExternal(url).then(r => console.log(r));
            }
        });


        tray = new Tray(path.join(__dirname, 'teams.png'));

        const contextMenu = Menu.buildFromTemplate([
            {label: 'Show App', click: () => mainWindow.show()},
            {label: 'Minimize to Tray', click: () => mainWindow.hide()},
            {type: 'separator'},
            {label: 'Quit', click: () => app.quit()}
        ]);

        tray.setToolTip('Microsoft Teams');
        tray.setContextMenu(contextMenu);

        tray.on('click', () => {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                // If we were flashing the frame, stop when the user clicks on the tray
                if (process.platform === 'win32') {
                    mainWindow.flashFrame(false);
                }
            }
        });

        // Focus and show on notifications
        mainWindow.on('focus', () => {
            if (process.platform === 'win32') {
                mainWindow.flashFrame(false);
            }
        });
    });

    // Add this where you create notifications in your app
// (likely in response to the 'new-notification' IPC event)

    function createNotification(title, body) {
        const notification = new Notification({
            title: title,
            body: body,
            silent: false,
            // Add an icon if you have one
            icon: path.join(__dirname, 'teams.png')
        });

        notification.on('click', () => {
            // Make sure window is visible and focused when notification is clicked
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                if (!mainWindow.isVisible()) mainWindow.show();
                mainWindow.focus();

                // If we were flashing the frame, stop when notification is clicked
                if (process.platform === 'win32') {
                    mainWindow.flashFrame(false);
                }
            }
        });

        notification.show();
    }

// Add this IPC handler in your main.js where other event listeners are defined
    ipcMain.on('new-notification', (event, notificationData) => {
        createNotification(notificationData.title, notificationData.body);
    });


    ipcMain.on("update-badge-count", (event, count) => {
        updateTray(count);
    });

    app.whenReady().then(() => {
        mainWindow.on('close', (event) => {
            if (!app.isQuitting) {
                event.preventDefault();
                mainWindow.hide();
                return false;
            }
            return true;
        });
    });

    app.on('before-quit', () => {
        app.isQuitting = true;
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
}
function testNotification() {
    createNotification('Test Notification', 'Click me to open the app!');
}

// You could add a global shortcut to test it
app.whenReady().then(() => {
    // Your existing code...

    // Optional: Add a shortcut for testing notifications
    // Uncomment this if needed

    const { globalShortcut } = require('electron');
    globalShortcut.register('CommandOrControl+Shift+N', () => {
      testNotification();
    });

});
