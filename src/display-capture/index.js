const { ipcMain, WebContentsView } = require("electron");
const path = require("path");

/**
 * StreamSelector class handles the display capture interface
 * for selecting screen sharing sources
 */
class StreamSelector {
    /**
     * Creates a new StreamSelector instance
     * @param {BrowserWindow} parentWindow - The parent window
     */
    constructor(parentWindow) {
        this.parentWindow = parentWindow;
        this.webContentsView = null;
        this.selectedSource = null;
        this.completionCallback = null;
    }

    /**
     * Shows the stream selector interface
     * @param {Function} callback - Callback function to call when selection is complete
     */
    show(callback) {
        this.completionCallback = callback;
        this._createWebContentsView();
        this._loadInterface();
        this._setupEventHandlers();
        this._resizeView();
    }

    /**
     * Creates the WebContentsView for the interface
     * @private
     */
    _createWebContentsView() {
        this.webContentsView = new WebContentsView({
            webPreferences: {
                preload: path.join(__dirname, "preload.js")
            }
        });
    }

    /**
     * Loads the HTML interface
     * @private
     */
    _loadInterface() {
        this.webContentsView.webContents
            .loadFile(path.join(__dirname, "index.html"))
            .catch(error => console.error('Failed to load display capture interface:', error));
        
        this.parentWindow.contentView = this.webContentsView;
    }

    /**
     * Sets up event handlers for window resize and IPC communication
     * @private
     */
    _setupEventHandlers() {
        const handleResize = () => this._resizeView();
        const handleClose = (event, source) => this._closeView(handleResize, handleClose, source);

        this.parentWindow.on("resize", handleResize);
        ipcMain.once("selected-source", handleClose);
        ipcMain.once("close-view", handleClose);
    }

    /**
     * Closes the view and cleans up event handlers
     * @param {Function} resizeHandler - The resize event handler
     * @param {Function} closeHandler - The close event handler
     * @param {*} source - The selected source
     * @private
     */
    _closeView(resizeHandler, closeHandler, source) {
        this.parentWindow.contentView = null;
        this.webContentsView.webContents.destroy();
        this.webContentsView = null;
        
        this.parentWindow.removeListener("resize", resizeHandler);
        ipcMain.removeListener("selected-source", closeHandler);
        ipcMain.removeListener("close-view", closeHandler);

        if (this.completionCallback) {
            this.completionCallback(source);
        }
    }

    /**
     * Resizes the view to fit the parent window
     * @private
     */
    _resizeView() {
        setTimeout(() => {
            const bounds = this.parentWindow.getBounds();
            const interfaceHeight = Math.min(400, bounds.height * 0.4);

            this.webContentsView.setBounds({
                x: 0,
                y: bounds.height - interfaceHeight,
                width: bounds.width,
                height: interfaceHeight
            });

            console.log('Display capture selector positioned with height:', interfaceHeight);
        }, 0);
    }
}

module.exports = {StreamSelector};
