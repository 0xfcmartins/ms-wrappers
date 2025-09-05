/**
 * IPC Security Validation Module
 * 
 * Provides security validation for IPC channels as a compensating control
 * for disabled contextIsolation and sandbox features.
 */

// Allowlist of legitimate IPC channels used by Teams for Linux
const allowedChannels = new Set([
  // Core application channels
  'config-file-changed',
  'get-config', 
  'get-system-idle-state',
  'get-app-version',
  
  // Zoom and display controls
  'get-zoom-level',
  'save-zoom-level',
  
  // Screen sharing and desktop capture - New secure implementation
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
  'close-preview-window',
  'close-preview-window',
  'stop-screen-sharing-from-thumbnail',
  // Internal StreamSelector IPC
  'source-selected',
  'selection-cancelled',
  
  // Notifications and user interaction
  'play-notification-sound',
  'show-notification',
  'user-status-changed',
  'set-badge-count',
  'tray-update',
  
  // Call management
  'incoming-call-created',
  'incoming-call-ended',
  'incoming-call-action',
  'call-connected',
  'call-disconnected',
  
  // Authentication and forms
  'submitForm',
  
  // Custom backgrounds
  'get-custom-bg-list',
  
  // Connection management
  'offline-retry',
  'stop-sharing'
]);

/**
 * Validates an IPC channel request
 * @param {string} channel - The IPC channel name
 * @param {any} payload - The payload being sent
 * @returns {boolean} - True if request is valid, false if blocked
 */
function validateIpcChannel(channel, payload = null) {
  // Check channel allowlist
  if (!allowedChannels.has(channel)) {
    console.warn(`[IPC Security] Blocked unauthorized channel: ${channel}`);
    return false;
  }
  
  // Basic payload sanitization to prevent prototype pollution
  if (payload && typeof payload === 'object') {
    // Use Object.getOwnPropertyDescriptor to safely check and delete dangerous properties
    const dangerousProps = ['__proto__', 'constructor', 'prototype'];
    dangerousProps.forEach(prop => {
      if (Object.hasOwn(payload, prop)) {
        delete payload[prop];
      }
    });
  }
  
  return true;
}

module.exports = { validateIpcChannel, allowedChannels };