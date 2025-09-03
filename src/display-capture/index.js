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
  if (activeStreamSelector) {
    activeStreamSelector.handleSelection(source);
  }
});

ipcMain.on('selection-cancelled', (event) => {
  if (activeStreamSelector) {
    activeStreamSelector.handleSelection(null);
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
    // Generate correlation ID for telemetry tracking
    const correlationId = `ss-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[StreamSelector] Starting selection process [${correlationId}]`);
    if (this.pickerWindow) {
      // If picker is already open, focus it
      this.pickerWindow.focus();
      return;
    }

    this.currentCallback = callback;
    this.correlationId = correlationId;
    
    // Set this instance as the active one for IPC handlers
    activeStreamSelector = this;

    try {
      console.log(`[StreamSelector] Fetching desktop sources [${correlationId}]`);
      // Get available sources
      this.sources = await desktopCapturer.getSources({ 
        types: ['window', 'screen'],
        thumbnailSize: { width: 300, height: 200 }
      });

      console.log(`[StreamSelector] Found ${this.sources.length} sources [${correlationId}]`);

      if (this.sources.length === 0) {
        console.error(`[StreamSelector] No desktop sources available [${correlationId}]`);
        this.showUserFriendlyError('No screens or windows are available for sharing. Please check your system permissions.');
        return;
      }

      this.createPickerWindow();
    } catch (error) {
      console.error(`[StreamSelector] Error getting desktop sources [${correlationId}]:`, error);
      
      // Provide user-friendly error messages based on error type
      let userMessage = 'Unable to access screen sharing sources. ';
      if (error.message?.includes('denied')) {
        userMessage += 'Please grant screen recording permissions in your system settings.';
      } else if (error.message?.includes('timeout')) {
        userMessage += 'The system took too long to respond. Please try again.';
      } else {
        userMessage += 'Please restart the application or check your system settings.';
      }
      
      this.showUserFriendlyError(userMessage);
    }
  }

  createPickerWindow() {
    this.pickerWindow = new BrowserWindow({
      width: 800,
      height: 600,
      modal: true,
      parent: this.parentWindow,
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
      // Send sources to renderer
      this.pickerWindow.webContents.send('sources-available', this.sources);
    });

    this.pickerWindow.on('closed', () => {
      this.pickerWindow = null;
      // If window was closed without selection, call callback with null
      if (this.currentCallback) {
        this.handleSelection(null);
      }
    });
  }

  handleSelection(selectedSource) {
    const correlationId = this.correlationId || 'unknown';
    
    if (selectedSource) {
      console.log(`[StreamSelector] Selection completed: ${selectedSource.name} (${selectedSource.id}) [${correlationId}]`);
      
      // Map the serialized source back to the original DesktopCapturerSource
      // This ensures we have the full object with all required properties
      const originalSource = this.sources.find(source => source.id === selectedSource.id);
      if (originalSource) {
        selectedSource = originalSource;
        console.log(`[StreamSelector] Mapped to original source object [${correlationId}]`);
      } else {
        console.warn(`[StreamSelector] Could not find original source for ID: ${selectedSource.id} [${correlationId}]`);
      }
    } else {
      console.log(`[StreamSelector] Selection cancelled or failed [${correlationId}]`);
    }
    
    if (this.currentCallback) {
      const callback = this.currentCallback;
      this.currentCallback = null;
      this.correlationId = null;
      
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