/**
 * StreamSelector Preload Script
 * 
 * Provides secure IPC communication between the renderer process and main process
 * while maintaining contextIsolation security boundaries.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose secure API to renderer process
contextBridge.exposeInMainWorld('streamSelector', {
  /**
   * Listen for available sources from main process
   * @param {Function} callback - Callback to handle sources data
   */
  onSourcesAvailable: (callback) => {
    ipcRenderer.on('sources-available', (event, sources) => {
      callback(sources);
    });
  },

  /**
   * Send selected source back to main process
   * @param {Object} source - Selected source object
   */
  selectSource: (source) => {
    ipcRenderer.send('source-selected', source);
  },

  /**
   * Cancel source selection
   */
  cancelSelection: () => {
    ipcRenderer.send('selection-cancelled');
  },

  /**
   * Remove all event listeners (cleanup)
   */
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('sources-available');
  }
});

// Log when preload script is loaded for debugging
console.log('[StreamSelector] Preload script loaded with secure context bridge');