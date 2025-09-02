const { createIpcBridge } = require('../utils/ipc-bridge');

createIpcBridge('api', {
    sendChannels: ['selected-source', 'close-view']
});

const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("legacyApi", {
    selectedSource: (args) => window.api.send("selected-source", args)
});
