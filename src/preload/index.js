/* global window */
/* global MutationObserver */
/* global Node */
/* global document */

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

    function setupNotificationObserver() {
      const notificationsArea = document.querySelector('[data-tid="app-layout-area--in-app-notifications"]');

      if (!notificationsArea) {
        setTimeout(setupNotificationObserver, 100);
        return;
      }

      console.log('✅ Found notifications area, setting up targeted observer');

      const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
          mutation.addedNodes.forEach((addedNode) => {
            if (addedNode.nodeType === Node.ELEMENT_NODE) {
              const senderElement = addedNode.querySelector('span[id^="cn-normal-notification-toast-header-"]');
              const messageElement = addedNode.querySelector('span[id^="cn-normal-notification-main-content-"]');

              const sender = senderElement ? senderElement.innerText.trim() : '';
              const messagePreview = messageElement ? messageElement.innerText.trim() : '';

              if (sender && messagePreview) {
                ipcRenderer.send('new-notification', {
                  title: sender,
                  body: messagePreview
                });
              }
            }
          });
        }
      });

      observer.observe(notificationsArea, {
        childList: true,
        subtree: true
      });

      console.log('✅ Teams notification MutationObserver active on notifications area!');
    }

    setupNotificationObserver();
  });

} catch (error) {
  console.error('❌ Error executing preload script:', error);
}