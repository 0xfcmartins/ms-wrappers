try {
  const { contextBridge, ipcRenderer } = require('electron');
  const { allowedChannels } = require('../security/ipcValidator');

  contextBridge.exposeInMainWorld('api', {
    send: (channel, data) => {
      console.log(`Sending on channel: ${channel}`, data);
      const validChannels = ['new-notification'];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);

      }
    },
  });


// IPC Security: Create a safe wrapper for ipcRenderer.send
const send = (channel, data) => {
  if (allowedChannels.has(channel)) {
    ipcRenderer.send(channel, data);
  } else {
    console.error(`[IPC Security] Blocked send to unauthorized channel: ${channel}`);
  }
};

// IPC Security: Create a safe wrapper for ipcRenderer.invoke
const invoke = async (channel, data) => {
  if (allowedChannels.has(channel)) {
    return await ipcRenderer.invoke(channel, data);
  } else {
    console.error(`[IPC Security] Blocked invoke to unauthorized channel: ${channel}`);
    throw new Error(`Unauthorized IPC channel: ${channel}`);
  }
};

// IPC Security: Create a safe wrapper for ipcRenderer.on
const on = (channel, func) => {
  if (allowedChannels.has(channel)) {
    // Deliberately strip event as it includes `sender`
    const subscription = (event, ...args) => func(...args);
    ipcRenderer.on(channel, subscription);

    // Return a cleanup function
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  } else {
    console.error(`[IPC Security] Blocked listener for unauthorized channel: ${channel}`);
    return () => {}; // Return a no-op cleanup function
  }
};

contextBridge.exposeInMainWorld('electron', {
  send,
  invoke,
  on,
  zoomChange: (direction) => send('zoom-change', direction),

  // Screen sharing API
  screenShare: {
    trigger: () => invoke('trigger-screen-share'),
    stop: () => send('screen-sharing-stopped'),
    getStatus: () => invoke('get-screen-sharing-status'),
    getStreamId: () => invoke('get-screen-share-stream'),
    getScreen: () => invoke('get-screen-share-screen'),
    onSourceSelected: (callback) => on('screen-sharing-source-selected', callback),
    onStatusChanged: (callback) => on('screen-sharing-status-changed', callback),
  },

  // Notification API
  notifications: {
    onNew: (callback) => on('new-notification', callback),
  },
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
