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

  contextBridge.exposeInMainWorld('electronAPI', {
    // Legacy screen sharing methods for compatibility
    sendScreenSharingStarted: (sourceId) =>
      ipcRenderer.send("screen-sharing-started", sourceId),
    sendScreenSharingStopped: () => ipcRenderer.send("screen-sharing-stopped"),
    send: (channel, ...args) => {
      if (
        [
          "active-screen-share-stream",
          "screen-sharing-stopped",
          "screen-sharing-started",
        ].includes(channel)
      ) {
        return ipcRenderer.send(channel, ...args);
      }
    },

    // Enhanced screen sharing API
    screenShare: {
      /**
       * Trigger screen share selection process
       * @returns {Promise<boolean>} Success status
       */
      start: async () => {
        try {
          ipcRenderer.send('trigger-screen-share');
          return true;
        } catch (error) {
          console.error('[ScreenShare API] Error starting screen share:', error);
          return false;
        }
      },

      /**
       * Stop active screen sharing
       * @returns {Promise<boolean>} Success status
       */
      stop: async () => {
        try {
          ipcRenderer.send('screen-sharing-stopped');
          return true;
        } catch (error) {
          console.error('[ScreenShare API] Error stopping screen share:', error);
          return false;
        }
      },

      /**
       * Get current screen sharing status
       * @returns {Promise<boolean>} Active status
       */
      getStatus: async () => {
        try {
          return await ipcRenderer.invoke('get-screen-sharing-status');
        } catch (error) {
          console.error('[ScreenShare API] Error getting status:', error);
          return false;
        }
      },

      /**
       * Subscribe to screen sharing status changes
       * @param {Function} callback - Status change callback
       */
      onStatusChange: (callback) => {
        const handler = (event, data) => {
          callback(data?.isActive || false);
        };
        ipcRenderer.on('screen-sharing-status-changed', handler);
        
        // Return cleanup function
        return () => {
          ipcRenderer.removeListener('screen-sharing-status-changed', handler);
        };
      }
    }
  });

  ipcRenderer.send('preload-executed');

  function throttle(callback, delay) {
    let lastCall = 0;
    return function(...args) {
      const now = new Date().getTime();
      if (now - lastCall < delay) {
        return;
      }
      lastCall = now;
      return callback(...args);
    };
  }

  function parseNotificationHtml(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    const notificationButton = doc.querySelector('button[aria-roledescription="Notification"]');
    if (!notificationButton) return { title: '', text: '' };

    const contentWrapper = notificationButton.querySelectorAll('div[aria-hidden="true"]')[1];
    if (!contentWrapper) return { title: '', text: '' };

    const innerDivs = contentWrapper.querySelectorAll('div');

    const title = innerDivs[0]?.textContent.trim() ?? '';
    const subtitle = innerDivs[1]?.textContent.trim() ?? '';
    const message = innerDivs[2]?.textContent.trim().replace(/\s+/g, ' ') ?? '';

    const fullText = [subtitle, message].filter(Boolean).join(' - ');

    return { title, text: fullText };
  }

  const throttledSendNotification = throttle((data) => {
    ipcRenderer.send('new-notification', data);
  }, 500);

  window.addEventListener('DOMContentLoaded', () => {

    function setupNotificationObserver() {
      let notificationsArea = document.querySelector('div[data-tid="app-layout-area--notifications"]')
          || document.querySelector('div[data-app-section="NotificationPane"]');

      if (!notificationsArea) {
        setTimeout(setupNotificationObserver, 100);
        return;
      }

      console.log('✅ Found notifications area, setting up targeted observer');

      const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
          if (mutation.type === 'childList' && mutation.addedNodes.length) {

            const notificationContainer = Array.from(mutation.addedNodes).find(
              node => node.nodeType === Node.ELEMENT_NODE &&
                    node.matches('[data-tid^="notification-container"]')
            );

            if (notificationContainer) {
              const sender = notificationContainer.querySelector('span[id^="cn-normal-notification-toast-header-"]')?.innerText.trim();
              const messagePreview = notificationContainer.querySelector('span[id^="cn-normal-notification-main-content-"]')?.innerText.trim();

              if (sender && messagePreview) {
                throttledSendNotification({
                  title: sender,
                  body: messagePreview
                });
              }
            }

            Array.from(mutation.addedNodes).forEach(node => {
              console.log(node);
              console.log(node.outerHTML);
              console.log('-----');
              console.log(node.innerText);
            });

            mutation.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const notificationButton = node.querySelector('button[aria-roledescription="Notification"]');
                if (notificationButton) {
                  console.log('✅ Notification Button found:', notificationButton);

                  const message = parseNotificationHtml(notificationButton.outerHTML);

                  throttledSendNotification({
                    title: message.title,
                    body: message.text
                  });
                }
              }
            });

          }
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
