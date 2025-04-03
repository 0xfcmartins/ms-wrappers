const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld(
  'api', {
    send: (channel, data) => {
      let validChannels = ['new-notification', 'update-badge-count'];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    }
  }
);