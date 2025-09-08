/**
 * StreamSelector - Unified screen sharing source selection
 *
 * Provides a consistent interface for screen source selection that works with
 * both setDisplayMediaRequestHandler and legacy IPC patterns.
 */

const { BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const path = require('path');

// Store reference to active StreamSelector instance for IPC handlers
let activeStreamSelector = null;

// Set up global IPC handlers
ipcMain.on('source-selected', (event, source) => {
  try {
    if (activeStreamSelector) {
      activeStreamSelector.handleSelection(source);
    } else {
      console.warn('[StreamSelector] No active selector for source selection');
    }
  } catch (error) {
    console.error('[StreamSelector] Error handling source selection:', error);
  }
});

ipcMain.on('selection-cancelled', (event) => {
  try {
      activeStreamSelector.handleSelection(null);
  } catch (error) {
    console.error('[StreamSelector] Error handling selection cancellation:', error);
  }
});

class StreamSelector {
  constructor(parentWindow) {
    this.parentWindow = parentWindow;
    this.pickerWindow = null;
    this.currentCallback = null;
    this.sources = [];
  }

  /**
   * Show the source selector and return selected source
   * @param {Function} callback - Callback to execute with selected source
   */
  async show(callback) {
    console.log('[StreamSelector] Starting selection process');

    if (this.pickerWindow) {
      // If picker is already open, focus it
      this.pickerWindow.focus();
      return;
    }

    this.currentCallback = callback;

    // Set this instance as the active one for IPC handlers
    activeStreamSelector = this;

    try {
      console.log('[StreamSelector] Fetching desktop sources');
      // Get available sources
      this.sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 300, height: 200 }
      });

      console.log(`[StreamSelector] Found ${this.sources.length} sources`);

      if (this.sources.length === 0) {
        console.error('[StreamSelector] No desktop sources available');
        this.handleSelection(null);
        return;
      }

      this.createPickerWindow();
    } catch (error) {
      console.error('[StreamSelector] Error getting desktop sources:', error);
      this.handleSelection(null);
    }
  }

  createPickerWindow() {
    this.pickerWindow = new BrowserWindow({
      width: 800,
      height: 600,
      modal: true,
      parent: this.parentWindow,
      frame: false,
      resizable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
      show: false,
      title: 'Select Screen to Share'
    });

    this.pickerWindow.loadFile(path.join(__dirname, 'index.html'));

    this.pickerWindow.once('ready-to-show', () => {
      this.pickerWindow.show();
      // Send serializable sources to renderer
      const serializableSources = this.sources.map(source => ({
        id: source.id,
        name: source.name,
        display_id: source.display_id,
        thumbnail: source.thumbnail.toDataURL(),
        appIcon: source.appIcon ? source.appIcon.toDataURL() : null
      }));
      this.pickerWindow.webContents.send('sources-available', serializableSources);
    });

    this.pickerWindow.on('closed', () => {
      this.pickerWindow = null;
    });
  }

  handleSelection(selectedSource) {
    if (selectedSource) {
      console.log(`[StreamSelector] Selection completed: ${selectedSource.name} (${selectedSource.id})`);

      // Map the serialized source back to the original DesktopCapturerSource
      const originalSource = this.sources.find(source => source.id === selectedSource.id);
      if (originalSource) {
        selectedSource = originalSource;
        console.log(`[StreamSelector] Mapped to original source object`);
      } else {
        console.warn(`[StreamSelector] Could not find original source for ID: ${selectedSource.id}`);
      }
    } else {
      console.log(`[StreamSelector] Selection cancelled or failed`);
    }

    if (this.currentCallback) {
      const callback = this.currentCallback;
      this.currentCallback = null;

      // Clear the active stream selector reference
      if (activeStreamSelector === this) {
        activeStreamSelector = null;
      }

      // Close picker window if open
      if (this.pickerWindow && !this.pickerWindow.isDestroyed()) {
        this.pickerWindow.close();
      }

      callback(selectedSource);
    }
  }

  /**
   * Show user-friendly error message and handle selection failure
   * @param {string} message - User-friendly error message
   */
  showUserFriendlyError(message) {
    const correlationId = this.correlationId || 'unknown';
    console.error(`[StreamSelector] User error: ${message} [${correlationId}]`);

    // For now, we'll handle this by calling the callback with null
    // In the future, this could show a proper error dialog
    this.handleSelection(null);

    // Could also emit an event or show a dialog here
    if (this.parentWindow && !this.parentWindow.isDestroyed()) {
      // Send error notification to main window for user display
      this.parentWindow.webContents.send('screen-share-error', {
        message,
        correlationId,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Cancel current selection process
   */
  cancel() {
    this.handleSelection(null);
  }

  /**
   * Check if picker is currently open
   */
  isOpen() {
    return this.pickerWindow !== null && !this.pickerWindow.isDestroyed();
  }
}

module.exports = { StreamSelector };