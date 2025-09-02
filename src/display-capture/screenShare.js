(function () {
  let isScreenSharing = false;
  let activeStreams = [];
  let activeMediaTracks = [];

  /**
   * Determines if the given constraints indicate a screen sharing request
   * @param {Object} constraints - Media constraints object
   * @returns {boolean} - True if constraints indicate screen sharing
   */
  function isScreenShareConstraints(constraints) {
    return constraints?.video &&
           (constraints.video.chromeMediaSource === "desktop" ||
            constraints.video.mandatory?.chromeMediaSource === "desktop" ||
            constraints.video.chromeMediaSourceId ||
            constraints.video.mandatory?.chromeMediaSourceId ||
            (typeof constraints.video === "object" &&
             constraints.video.deviceId &&
             typeof constraints.video.deviceId === "object" &&
             constraints.video.deviceId?.exact));
  }

  /**
   * Creates a proxy for getDisplayMedia to monitor screen sharing
   * @returns {Function} - Proxied getDisplayMedia function
   */
  function createGetDisplayMediaProxy() {
    const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(
      navigator.mediaDevices
    );

    return function (constraints) {
      return originalGetDisplayMedia(constraints)
        .then((stream) => {
          console.debug("Screen sharing stream detected via getDisplayMedia");
          handleScreenShareStream(stream, "getDisplayMedia");
          return stream;
        })
        .catch((error) => {
          console.error("getDisplayMedia error:", error);
          throw error;
        });
    };
  }

  /**
   * Creates a proxy for getUserMedia to monitor screen sharing
   * @returns {Function} - Proxied getUserMedia function
   */
  function createGetUserMediaProxy() {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    );

    return function (constraints) {
      return originalGetUserMedia(constraints)
        .then((stream) => {
          if (isScreenShareConstraints(constraints)) {
            console.debug("Screen sharing stream detected");
            handleScreenShareStream(stream, "getUserMedia");
          }
          return stream;
        })
        .catch((error) => {
          console.error("getUserMedia error:", error);
          throw error;
        });
    };
  }

  /**
   * Sets up monitoring of screen sharing by proxying media device methods
   */
  function monitorScreenSharing() {
    navigator.mediaDevices.getDisplayMedia = createGetDisplayMediaProxy();
    navigator.mediaDevices.getUserMedia = createGetUserMediaProxy();
  }

  /**
   * Generates a unique source ID for the stream
   * @param {MediaStream} stream - The media stream
   * @returns {string} - Unique source ID
   */
  function generateSourceId(stream) {
    return stream?.id ? stream.id : `screen-share-${crypto.randomUUID()}`;
  }

  /**
   * Notifies Electron about screen sharing start
   * @param {string} sourceId - The source ID
   */
  function notifyScreenSharingStarted(sourceId) {
    const electronAPI = window.electronAPI;
    
    if (electronAPI?.sendScreenSharingStarted) {
      electronAPI.sendScreenSharingStarted(sourceId);
      console.debug("Screen sharing stream established locally with ID:", sourceId);
    }
  }

  /**
   * Sets up video track monitoring for the stream
   * @param {MediaStream} stream - The media stream
   */
  function setupVideoTrackMonitoring(stream) {
    const videoTracks = stream.getVideoTracks();
    activeMediaTracks.push(...videoTracks);

    videoTracks.forEach((track, index) => {
      track.addEventListener("ended", () => {
        console.debug(`Video track ${index} ended (popup remains open)`);
      });
    });
  }

  /**
   * Handles the initialization of a screen sharing stream
   * @param {MediaStream} stream - The media stream
   * @param {string} source - The source of the stream (getDisplayMedia or getUserMedia)
   */
  function handleScreenShareStream(stream, source) {
    console.debug("Screen sharing stream started from:", source);

    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      console.error("electronAPI not available");
      return;
    }

    isScreenSharing = true;
    activeStreams.push(stream);

    const sourceId = generateSourceId(stream);
    notifyScreenSharingStarted(sourceId);
    
    startUIMonitoring();
    setupVideoTrackMonitoring(stream);
  }

  /**
   * Handles the end of screen sharing
   * @param {string} reason - The reason for ending
   */
  function handleStreamEnd(reason) {
    console.debug("Stream ending detected, reason:", reason);

    if (!isScreenSharing) {
      return;
    }

    isScreenSharing = false;

    const electronAPI = window.electronAPI;
    if (electronAPI?.sendScreenSharingStopped) {
      electronAPI.sendScreenSharingStopped();
    }

    activeStreams = [];
    activeMediaTracks = [];
  }

  /**
   * Configuration object containing UI selectors for screen sharing controls
   */
  const UI_CONFIG = {
    stopSharingSelectors: [
      '[data-tid*="stop-share"]',
      '[data-tid*="stopShare"]',
      '[data-tid*="screen-share"][data-tid*="stop"]',
      'button[title*="Stop sharing"]',
      'button[aria-label*="Stop sharing"]',
      '[data-tid="call-screen-share-stop-button"]',
      '[data-tid="desktop-share-stop-button"]',
      ".ts-calling-screen-share-stop-button",
      'button[data-testid*="stop-sharing"]',
      '[data-tid*="share"] button',
      ".share-stop-button",
      '[aria-label*="share"]',
      '[title*="share"]',
      '[data-tid*="hangup"]',
      '[data-tid*="call-end"]',
      'button[data-tid="call-hangup"]'
    ],
    checkInterval: 2000
  };

  /**
   * Handles stop sharing button clicks
   * @param {Event} event - The click event
   */
  function handleStopSharing(event) {
    console.debug("Stop sharing button clicked", event);
    
    if (isScreenSharing) {
      terminateActiveStreams();
    }
  }

  /**
   * Adds event listeners to stop sharing buttons
   * @returns {number} - Number of buttons that had listeners added
   */
  function addStopSharingListeners() {
    let foundButtons = 0;

    foundButtons = monitorScreenSharingButtons(
      UI_CONFIG.stopSharingSelectors,
      foundButtons,
      handleStopSharing
    );

    if (foundButtons > 0) {
      console.debug("Added stop sharing listeners to", foundButtons, "buttons");
    }

    return foundButtons;
  }

  /**
   * Creates a mutation observer to monitor DOM changes
   * @returns {MutationObserver} - The configured mutation observer
   */
  function createDOMObserver() {
      return new MutationObserver((mutations) => {
        let shouldCheckForButtons = false;

        mutations.forEach((mutation) => {
            if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
                shouldCheckForButtons = true;
            }
        });

        if (shouldCheckForButtons) {
            addStopSharingListeners();
        }
    });
  }

  /**
   * Starts monitoring UI for screen sharing controls
   */
  function startUIMonitoring() {
    console.debug("Starting UI monitoring for screen sharing controls");

    const observer = createDOMObserver();
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    addStopSharingListeners();

    const checkInterval = setInterval(() => {
      if (isScreenSharing) {
        addStopSharingListeners();
      } else {
        clearInterval(checkInterval);
      }
    }, UI_CONFIG.checkInterval);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      monitorScreenSharing();
    });
  } else {
    monitorScreenSharing();
  }

  function monitorScreenSharingButtons(
    stopSharingSelectors,
    foundButtons,
    handleStopSharing
  ) {
    stopSharingSelectors.forEach((selector) => {
      const elements = document.querySelectorAll(selector);

      elements.forEach((element) => {
        if (!element.hasAttribute("data-screen-share-monitored")) {
          foundButtons++;
          element.setAttribute("data-screen-share-monitored", "true");
          element.addEventListener("click", handleStopSharing);
        }
      });
    });
    return foundButtons;
  }

  function terminateActiveStreams() {
    activeMediaTracks.forEach((track) => {
      track.stop();
    });

    activeStreams.forEach((stream) => {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
    });

    setTimeout(() => {
      handleStreamEnd("ui-button-click");
    }, 500);
  }
})();
