/* global window */

try {
  const { contextBridge, ipcRenderer } = require('electron');

  contextBridge.exposeInMainWorld('api', {
    send: (channel, data) => {
      console.log(`Sending on channel: ${channel}`, data);
      const validChannels = ['new-notification'];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
  });

  ipcRenderer.send('preload-executed');

  window.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM loaded explicitly. Setting up MutationObserver explicitly to observe Teams DOM notifications!');

    const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        mutation.addedNodes.forEach((addedNode) => {
          if (addedNode.nodeType === Node.ELEMENT_NODE) {
            const elementText = addedNode.innerText;
            if (elementText && elementText.match(/(sent a message|mentioned you|New message|replied to)/i)) {
              console.log('✅ DOM-based Teams notification explicitly intercepted:', elementText.trim());

              window.api.send('new-notification', {
                title: 'Teams Notification',
                body: elementText.trim(),
              });
            }
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('✅ Teams notification MutationObserver explicitly active!');
  });

} catch (error) {
  console.error('❌ Error executing preload script:', error);
}