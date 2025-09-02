const { createIpcBridge } = require('../utils/ipc-bridge');

// Configure IPC channels for source selector
createIpcBridge('electron', {
    sendChannels: ['source-selected'],
    receiveChannels: ['sources-list']
});
