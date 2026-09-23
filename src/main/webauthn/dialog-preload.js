// Sandboxed preload for the security-key dialog: only 'electron' can be required here.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('keyDialog', {
    submitPin: (pin) => ipcRenderer.send('webauthn-dialog', {action: 'pin', pin}),
    cancel: () => ipcRenderer.send('webauthn-dialog', {action: 'cancel'}),
    onState: (callback) => ipcRenderer.on('webauthn-dialog-state', (_event, state) => callback(state)),
});
