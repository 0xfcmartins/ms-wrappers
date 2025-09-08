const { contextBridge, ipcRenderer } = require('electron');

/**
 * IPC Bridge Utility
 * 
 * This module provides a standardized way to create secure IPC communication
 * bridges between Electron's main and renderer processes. It validates channels
 * and provides a consistent API across different components.
 * 
 * @module IPCBridge
 */

/**
 * Configuration object for IPC bridge setup
 * @typedef {Object} IPCBridgeConfig
 * @property {string[]} [sendChannels=[]] - Array of valid channels for sending data
 * @property {string[]} [receiveChannels=[]] - Array of valid channels for receiving data
 */

/**
 * Creates a standardized IPC bridge with channel validation
 * 
 * This function creates a secure IPC bridge that validates channel names
 * before allowing communication. It exposes methods in the main world
 * context that can be safely used by renderer processes.
 * 
 * @param {string} namespace - The namespace to expose in the main world (e.g., 'api', 'electron')
 * @param {IPCBridgeConfig} config - Configuration object containing channel mappings
 * @throws {Error} When invalid channels are used
 * 
 * @example
 * // Create an IPC bridge for display capture
 * createIpcBridge('api', {
 *   sendChannels: ['selected-source', 'close-view'],
 *   receiveChannels: ['sources-list']
 * });
 * 
 * // Usage in renderer process
 * window.api.send('selected-source', sourceData);
 * window.api.on('sources-list', (sources) => { ... });
 */
function createIpcBridge(namespace, config) {
    const { sendChannels = [], receiveChannels = [] } = config;
    
    if (!namespace || typeof namespace !== 'string') {
        throw new Error('Namespace must be a non-empty string');
    }
    
    const api = {};
    
    // Create send methods for one-way communication
    if (sendChannels.length > 0) {
        /**
         * Sends data to the main process via IPC
         * @param {string} channel - The channel name
         * @param {*} data - The data to send
         */
        api.send = (channel, data) => {
            if (sendChannels.includes(channel)) {
                return ipcRenderer.send(channel, data);
            }
            console.warn(`[IPC Bridge] Invalid send channel: ${channel}. Valid channels:`, sendChannels);
        };
        
        /**
         * Invokes a handler in the main process and returns a promise
         * @param {string} channel - The channel name
         * @param {*} data - The data to send
         * @returns {Promise} Promise that resolves with the response
         */
        api.invoke = (channel, data) => {
            if (sendChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, data);
            }
            console.warn(`[IPC Bridge] Invalid invoke channel: ${channel}. Valid channels:`, sendChannels);
            return Promise.reject(new Error(`Invalid channel: ${channel}`));
        };
    }
    
    // Create receive methods for listening to main process events
    if (receiveChannels.length > 0) {
        /**
         * Listens for messages from the main process
         * @param {string} channel - The channel name
         * @param {Function} callback - The callback function
         */
        api.on = (channel, callback) => {
            if (receiveChannels.includes(channel)) {
                ipcRenderer.on(channel, (event, ...args) => callback(...args));
            } else {
                console.warn(`[IPC Bridge] Invalid receive channel: ${channel}. Valid channels:`, receiveChannels);
            }
        };
        
        /**
         * Listens for a single message from the main process
         * @param {string} channel - The channel name
         * @param {Function} callback - The callback function
         */
        api.once = (channel, callback) => {
            if (receiveChannels.includes(channel)) {
                ipcRenderer.once(channel, (event, ...args) => callback(...args));
            } else {
                console.warn(`[IPC Bridge] Invalid receive channel: ${channel}. Valid channels:`, receiveChannels);
            }
        };
    }
    
    // Expose the API to the main world context
    contextBridge.exposeInMainWorld(namespace, api);
}

module.exports = { createIpcBridge };