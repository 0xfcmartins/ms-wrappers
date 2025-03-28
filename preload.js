const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    'api', {
        send: (channel, data) => {
            // whitelist channels
            let validChannels = ['new-notification', 'update-badge-count'];
            if (validChannels.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },
        receive: (channel, func) => {
            let validChannels = ['notification-response'];
            if (validChannels.includes(channel)) {
                // Deliberately strip event as it includes `sender`
                ipcRenderer.on(channel, (event, ...args) => func(...args));
            }
        }
    }
);

contextBridge.exposeInMainWorld('electronAPI', {
    // Allow sending notifications from renderer to main process
    sendNotification: (title, body) => {
        ipcRenderer.send('new-notification', { title, body });
    },

    // For badge count updates
    updateBadgeCount: (count) => {
        ipcRenderer.send('update-badge-count', count);
    }
});
