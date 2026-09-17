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

  // Separate throttle instance for the window.Notification interceptor below:
  // it runs independently of the DOM-based observers above, and sharing one
  // throttle meant a real notification from one path could silently swallow one
  // from the other if they fired within the same 500ms window.
  const throttledSendNativeNotification = throttle((data) => {
    ipcRenderer.send('new-notification', data);
  }, 500);

  // Strip icon-font placeholder glyphs (Private Use Area) and control chars mixed
  // into Outlook's screen-reader announcement text. Filtered by code point rather
  // than a \u-escape regex, since that form has previously been mangled into raw
  // control bytes when this file was edited through some toolchains. Replaced
  // with a space rather than dropped outright — a control char here is usually a
  // line break separating two pieces of text (e.g. sender line vs preview line),
  // and deleting it outright glues the words on either side together.
  function cleanAnnouncedText(text) {
    const PUA_START = 0xE000;
    const PUA_END = 0xF8FF;
    return Array.from(text)
      .map((ch) => {
        const code = ch.codePointAt(0);
        const isControl = code < 32;
        const isPUA = code >= PUA_START && code <= PUA_END;
        return (isControl || isPUA) ? ' ' : ch;
      })
      .join('')
      // extractSpacedText below inserts a space between DOM leaf text nodes, but
      // some boundaries (e.g. an avatar's initials rendered via CSS content, or
      // other non-text-node sources) still come through with no gap at all —
      // reported as e.g. "JSJim SmithInstall SnapsHiPaul,". Insert a space at
      // any lowercase→uppercase boundary (covers "SmithInstall", "tudoDaily",
      // "ExternoEsta", ...) and at a short ALL-CAPS run followed by a Titlecase
      // word (covers "JSJim" specifically, where both sides start uppercase).
      .replace(/([a-zà-ÿ0-9)])([A-ZÀ-Ý])/g, '$1 $2')
      .replace(/\b([A-ZÀ-Ý]{2,3})([A-ZÀ-Ý][a-zà-ÿ])/g, '$1 $2')
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

  function truncateAtWord(text, maxLength) {
    if (text.length <= maxLength) return text;
    const slice = text.slice(0, maxLength + 1);
    const lastSpace = slice.lastIndexOf(' ');
    return (lastSpace > 0 ? slice.slice(0, lastSpace) : text.slice(0, maxLength)).trim();
  }

  // A mail row's announced text looks like:
  //   "FM Francisco Martins (Sem assunto) INFORMATIVO · Externo Esta mensagem ..."
  //    ^avatar initials      ^subject      ^category  ^flag  ^actual preview text
  // " · " reliably separates the category+flag from everything else, so use it to
  // pull out just "sender + subject" as the title and the real preview as the
  // body, instead of showing the category/flag noise. Falls back to a plain
  // word-boundary truncation when that separator isn't present (e.g. internal
  // senders may not get a flag at all).
  function splitMailAnnouncement(cleaned, maxTitleLength) {
    // Avatar initials are always uppercase (e.g. "FM", "NN"); a real short first
    // name like "Zé"/"Rui"/"Ana" has lowercase letters and must survive here.
    // Applied unconditionally (both branches below), not just when a category/
    // flag separator is present.
    const withoutInitials = cleaned.replace(/^[A-ZÀ-Ú]{1,3}\s+/, '') || cleaned;

    const dotIndex = withoutInitials.indexOf(' · ');
    if (dotIndex === -1) {
      const title = truncateAtWord(withoutInitials, maxTitleLength);
      const body = withoutInitials.length > title.length ? withoutInitials.slice(title.length).trim() : title;
      return {title, body};
    }

    // Only drop these when they actually look like the label they're assumed to
    // be — most mail has no category/flag at all, so blindly popping/shifting a
    // word would just as often eat real subject/preview text instead.
    const KNOWN_FLAGS = ['externo', 'external', 'interno', 'internal'];
    const beforeWords = withoutInitials.slice(0, dotIndex).trim().split(' ');
    const lastBeforeWord = beforeWords[beforeWords.length - 1] || '';
    if (/^[A-ZÀ-Ú]{2,}$/.test(lastBeforeWord)) {
      beforeWords.pop(); // looks like an all-caps category label (e.g. "INFORMATIVO")
    }
    const afterWords = withoutInitials.slice(dotIndex + 3).trim().split(' ');
    const firstAfterWord = afterWords[0] || '';
    if (KNOWN_FLAGS.includes(firstAfterWord.toLowerCase())) {
      afterWords.shift(); // known flag label (e.g. "Externo")
    }

    const nameAndSubject = beforeWords.join(' ').trim();
    const preview = afterWords.join(' ').trim();

    return {
      title: nameAndSubject.slice(0, maxTitleLength) || truncateAtWord(withoutInitials, maxTitleLength),
      body: preview || nameAndSubject
    };
  }

  // The NotificationPane region is also used for the Reminders flyout (meeting
  // popups), which re-announces itself every time its "Xm ago"/"in Xm" countdown
  // ticks — that's not a new-mail event, and re-announcing it every minute would
  // spam duplicate notifications. "Dismiss all" is that flyout's own action
  // button label and won't appear in a mail row, so use it to filter this out.
  const NON_MAIL_PATTERNS = [/dispensar tudo/i, /dismiss all/i];

  // Outlook (outlook.office.com / outlook.cloud.microsoft) doesn't render a Teams-style
  // toast element for new mail. Instead it updates a div[data-app-section="NotificationPane"]
  // aria-live region with the new message's row text for screen readers — that's the only
  // reliable hook available for "new mail arrived".
  function setupOutlookNotificationObserver(area) {
    let lastText = '';
    const TITLE_LENGTH = 60;

    const observer = new MutationObserver(() => {
      const raw = extractSpacedText(area);
      if (!raw || raw === lastText) return;
      lastText = raw;

      const cleaned = cleanAnnouncedText(raw);
      if (!cleaned || NON_MAIL_PATTERNS.some((p) => p.test(cleaned))) return;

      const {title, body} = splitMailAnnouncement(cleaned, TITLE_LENGTH);

      throttledSendNotification({title, body: body.slice(0, 200)});
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

  // Second, independent detection path (running alongside the DOM observer above
  // while both are being evaluated): intercept window.Notification itself. Under
  // contextIsolation this preload's `window` is a separate JS realm from the
  // page's, so overriding window.Notification here has no effect on the page —
  // it has to be done by injecting a real <script> tag, which runs in the page's
  // own world. That script can't call back into this preload's functions
  // directly either, so it reports back via a CustomEvent on `document`, which
  // (unlike `window`) is one of the few objects actually shared between worlds.
  function setupNotificationApiInterceptor() {
    const script = document.createElement('script');
    script.textContent = `(function() {
      if (window.__outlookEwNotifyPatched) return;
      window.__outlookEwNotifyPatched = true;
      function PatchedNotification(title, options) {
        try {
          document.dispatchEvent(new CustomEvent('outlook-ew-notification', {
            detail: { title: String(title || ''), body: (options && options.body) || '' }
          }));
        } catch (e) {}
        this.title = title;
        this.body = options && options.body;
        this.onclick = null;
        this.onerror = null;
        this.close = function() {};
        this.addEventListener = function() {};
      }
      PatchedNotification.permission = 'granted';
      PatchedNotification.requestPermission = function(cb) {
        if (cb) cb('granted');
        return Promise.resolve('granted');
      };
      window.Notification = PatchedNotification;
      console.log('🔔 [OutlookNotify] window.Notification patched in page context');
    })();`;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();

    document.addEventListener('outlook-ew-notification', (event) => {
      const detail = (event && event.detail) || {};
      console.log('🔔 [OutlookNotify] Intercepted native Notification call:', detail.title);
      throttledSendNativeNotification({
        title: detail.title || 'Outlook',
        body: detail.body || ''
      });
    });
  }

  // Inject as early as possible (before the page's own scripts run) so we patch
  // window.Notification before anything can cache a reference to the original.
  setupNotificationApiInterceptor();

} catch (error) {
  console.error('❌ Error executing preload script:', error);
}
