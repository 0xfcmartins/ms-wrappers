try {
  const { contextBridge, ipcRenderer } = require('electron');

  // Duplicated from src/security/ipcValidator.js rather than required dynamically:
  // sandboxed preload scripts (the default since Electron 20, and always on for
  // child/popup windows such as OAuth popups) can only require a fixed set of
  // built-in modules, not arbitrary local files resolved at runtime. Keep this
  // list in sync with ipcValidator.js's allowedChannels.
  const allowedChannels = new Set([
    'config-file-changed',
    'get-config',
    'get-system-idle-state',
    'get-app-version',
    'get-zoom-level',
    'save-zoom-level',
    'zoom-change',
    'desktop-capturer-get-sources',
    'choose-desktop-media',
    'cancel-desktop-media',
    'trigger-screen-share',
    'screen-sharing-started',
    'screen-sharing-stopped',
    'screen-sharing-source-selected',
    'get-screen-sharing-status',
    'get-screen-share-stream',
    'get-screen-share-screen',
    'resize-preview-window',
    'minimize-preview-window',
    'close-preview-window',
    'stop-screen-sharing-from-thumbnail',
    'source-selected',
    'selection-cancelled',
    'new-notification',
    'play-notification-sound',
    'show-notification',
    'user-status-changed',
    'set-badge-count',
    'tray-update',
    'incoming-call-created',
    'incoming-call-ended',
    'incoming-call-action',
    'call-connected',
    'call-disconnected',
    'submitForm',
    'get-custom-bg-list',
    'offline-retry',
    'stop-sharing',
    'preload-executed'
  ]);

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

  // Strip icon-font placeholder glyphs (Private Use Area) and control chars mixed
  // into Outlook's screen-reader announcement text. Filtered by code point rather
  // than a \u-escape regex, since that form has previously been mangled into raw
  // control bytes when this file was edited through some toolchains.
  function cleanAnnouncedText(text) {
    const PUA_START = 0xE000;
    const PUA_END = 0xF8FF;
    return Array.from(text)
      .filter((ch) => {
        const code = ch.codePointAt(0);
        return code >= 32 && !(code >= PUA_START && code <= PUA_END);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // element.textContent glues adjacent elements' text together with no separator
  // (e.g. a sender name div right next to a subject span comes out
  // "Jane Doe(No subject)" with nothing between them). Walk to each leaf text
  // node and join with an explicit space instead, so words never merge.
  function extractSpacedText(el) {
    const parts = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) parts.push(text);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        node.childNodes.forEach(walk);
      }
    };
    walk(el);
    return parts.join(' ');
  }

  // Outlook (outlook.office.com / outlook.cloud.microsoft) doesn't render a Teams-style
  // toast element for new mail. Instead it updates a div[data-app-section="NotificationPane"]
  // aria-live region with the announcement text (new message row, reminder popup, etc.) for
  // screen readers — that's the only reliable hook available for these events.
  function setupOutlookNotificationObserver(area) {
    let lastText = '';
    const TITLE_LENGTH = 60;

    const observer = new MutationObserver(() => {
      const raw = extractSpacedText(area);
      if (!raw || raw === lastText) return;
      lastText = raw;

      const cleaned = cleanAnnouncedText(raw);
      if (!cleaned) return;

      throttledSendNotification({
        title: cleaned.slice(0, TITLE_LENGTH),
        body: cleaned.length > TITLE_LENGTH ? cleaned.slice(TITLE_LENGTH, TITLE_LENGTH + 200) : cleaned
      });
    });

    observer.observe(area, {childList: true, subtree: true, characterData: true});
    console.log('✅ Outlook notification MutationObserver active on NotificationPane!');
  }

  window.addEventListener('DOMContentLoaded', () => {

    function setupNotificationObserver() {
      const teamsArea = document.querySelector('div[data-tid="app-layout-area--notifications"]');
      const outlookArea = !teamsArea && document.querySelector('div[data-app-section="NotificationPane"]');
      const notificationsArea = teamsArea || outlookArea;

      if (!notificationsArea) {
        setTimeout(setupNotificationObserver, 100);
        return;
      }

      console.log('✅ Found notifications area, setting up targeted observer');

      if (outlookArea) {
        setupOutlookNotificationObserver(outlookArea);
        return;
      }

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
