// Wires FIDO2 security-key sign-in into the app: chooses the page script each preload
// injects, and runs navigator.credentials.get() ceremonies behind a PIN / touch dialog.
const fs = require('node:fs');
const path = require('node:path');
const {BrowserWindow} = require('electron');
const fido2 = require('./fido2');

const scripts = {
    bridge: fs.readFileSync(path.join(__dirname, 'page-bridge.js'), 'utf8'),
    neutralize: fs.readFileSync(path.join(__dirname, 'page-neutralize.js'), 'utf8'),
};

// Messages shown in the dialog for the fido2-tools errors a user can act on.
const RETRYABLE_ERRORS = {
    FIDO_ERR_PIN_INVALID: 'Wrong PIN, try again.',
    NO_DEVICE: 'No security key detected. Insert it and try again.',
    FIDO_ERR_ACTION_TIMEOUT: 'The key was not touched in time. Try again.',
    FIDO_ERR_NO_CREDENTIALS: 'This key holds no sign-in credential for this account.',
};

const FATAL_ERRORS = {
    FIDO_ERR_PIN_AUTH_BLOCKED: 'Too many wrong PINs. Remove and re-insert the key, then sign in again.',
    FIDO_ERR_PIN_BLOCKED: 'The key\'s PIN is blocked. It must be reset.',
    FIDO_ERR_PIN_NOT_SET: 'This key has no PIN. Set one with a FIDO2 tool first.',
};

class KeyDialog {
    pending = null;
    closed = false;

    constructor(parent) {
        this.window = new BrowserWindow({
            parent: parent || undefined,
            modal: !!parent,
            width: 400,
            height: 250,
            resizable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            autoHideMenuBar: true,
            title: 'Security key',
            show: false,
            webPreferences: {
                preload: path.join(__dirname, 'dialog-preload.js'),
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
            },
        });
        this.window.removeMenu();
        this.ready = new Promise(resolve => this.window.webContents.once('did-finish-load', resolve));
        this.window.once('ready-to-show', () => this.window.show());
        this.window.on('closed', () => {
            this.closed = true;
            this.resolve({action: 'cancel'});
        });
        this.window.loadFile(path.join(__dirname, 'dialog.html'));
    }

    get webContentsId() {
        return this.closed ? null : this.window.webContents.id;
    }

    resolve(value) {
        if (this.pending) {
            const {resolve} = this.pending;
            this.pending = null;
            resolve(value);
        }
    }

    // Resolves with {action: 'pin', pin} or {action: 'cancel'}.
    nextAction() {
        if (this.closed) {
            return Promise.resolve({action: 'cancel'});
        }
        return new Promise(resolve => { this.pending = {resolve}; });
    }

    async setState(state, message = '') {
        await this.ready;
        if (!this.closed) {
            this.window.webContents.send('webauthn-dialog-state', {state, message});
        }
    }

    close() {
        if (!this.closed) {
            this.window.close();
        }
    }
}

let activeDialog = null;

async function runCeremony(event, rawRequest) {
    const frame = event.senderFrame;
    // Top-level sign-in pages only: the origin comes from Chromium, never from the page.
    if (!frame || frame !== event.sender.mainFrame || !fido2.isAllowedOrigin(frame.origin)) {
        return {error: 'Security keys are not available on this page'};
    }
    if (activeDialog) {
        return {error: 'Another security key request is in progress'};
    }

    let request;
    try {
        request = fido2.parseRequest(rawRequest);
    } catch (error) {
        return {error: error.message};
    }

    const dialog = new KeyDialog(BrowserWindow.fromWebContents(event.sender));
    activeDialog = dialog;
    const deadline = setTimeout(() => dialog.close(), request.timeout);
    try {
        await dialog.setState('pin');
        for (;;) {
            const next = await dialog.nextAction();
            if (next.action !== 'pin') {
                return {error: 'The operation was cancelled'};
            }
            await dialog.setState('working', 'Checking the key…');
            try {
                const result = await fido2.getAssertion(request, frame.origin, next.pin,
                    () => dialog.setState('touch', 'Touch your security key now.'));
                console.info('[WebAuthn] Assertion completed for', frame.origin);
                return result;
            } catch (error) {
                console.warn('[WebAuthn] Ceremony failed:', error.code || '', error.message);
                if (FATAL_ERRORS[error.code]) {
                    await dialog.setState('fatal', FATAL_ERRORS[error.code]);
                    await dialog.nextAction();
                    return {error: FATAL_ERRORS[error.code]};
                }
                await dialog.setState('pin', RETRYABLE_ERRORS[error.code] || 'The security key failed. Try again.');
            }
        }
    } finally {
        clearTimeout(deadline);
        activeDialog = null;
        dialog.close();
    }
}

function registerWebAuthn(ipcMain) {
    // Synchronous: the preload must inject before any page script runs. The origin only
    // selects which script to inject; ceremonies re-check the real frame origin.
    ipcMain.on('webauthn-page-script', (event, origin) => {
        const bridge = fido2.isAllowedOrigin(origin) && fido2.isAvailable();
        event.returnValue = {bridge, script: bridge ? scripts.bridge : scripts.neutralize};
    });

    ipcMain.handle('webauthn-get', runCeremony);

    ipcMain.on('webauthn-dialog', (event, message) => {
        if (!activeDialog || event.sender.id !== activeDialog.webContentsId || !message) {
            return;
        }
        if (message.action === 'pin' && typeof message.pin === 'string' && message.pin.length > 0
            && message.pin.length <= 63 && !/[\r\n]/.test(message.pin)) {
            activeDialog.resolve({action: 'pin', pin: message.pin});
        } else if (message.action === 'cancel') {
            activeDialog.resolve({action: 'cancel'});
        }
    });
}

module.exports = {registerWebAuthn};
