// FIDO2 security-key support through Yubico's fido2-tools CLI (fido2-token / fido2-assert).
//
// Electron's Chromium ships no WebAuthn transport on Linux: navigator.credentials.get()
// is dispatched to a browser process that never answers. This module performs the
// assertion itself, following the WebAuthn Level 2 client algorithm, and the page-side
// override (page-bridge.js) hands the result back to the sign-in page.
//
// Pure helpers are exported for the unit tests; nothing here touches Electron.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

// Sign-in origins allowed to run a ceremony. Anything else keeps the neutralized API.
const ALLOWED_ORIGINS = new Set([
    'https://login.microsoftonline.com',
    'https://login.microsoft.com',
    'https://login.live.com',
]);

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 300000;

function toBase64Url(buffer) {
    return Buffer.from(buffer).toString('base64url');
}

function fromBase64Url(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(text)) {
        throw new TypeError('Invalid base64url value');
    }
    return Buffer.from(text, 'base64url');
}

function isAllowedOrigin(origin) {
    return ALLOWED_ORIGINS.has(origin);
}

// WebAuthn §5.1.4.1 step 8: the RP ID must equal the caller's effective domain or be a
// registrable suffix of it. The origin allowlist already excludes public suffixes, so a
// label-aligned suffix check with at least one dot is sufficient here.
function rpIdMatchesOrigin(rpId, origin) {
    if (typeof rpId !== 'string' || !rpId.includes('.') || rpId.startsWith('.')) {
        return false;
    }
    const host = new URL(origin).hostname;
    return host === rpId || host.endsWith('.' + rpId);
}

// WebAuthn §5.8.1 CollectedClientData. Key order matters for servers that verify a
// byte-exact serialization, so it follows the specification's limited serialization.
function buildClientDataJSON(challenge, origin) {
    return Buffer.from(JSON.stringify({
        type: 'webauthn.get',
        challenge: toBase64Url(challenge),
        origin,
        crossOrigin: false,
    }), 'utf8');
}

// fido2-assert prints the authenticator data as a CBOR byte string; WebAuthn wants the
// raw bytes. Only the byte-string major type (2) with definite length can appear.
function unwrapCborByteString(buffer) {
    const initial = buffer[0];
    if (initial === undefined || (initial >> 5) !== 2) {
        throw new Error('Authenticator data is not a CBOR byte string');
    }
    const info = initial & 0x1f;
    let length;
    let offset;
    if (info < 24) {
        length = info;
        offset = 1;
    } else if (info === 24) {
        length = buffer.readUInt8(1);
        offset = 2;
    } else if (info === 25) {
        length = buffer.readUInt16BE(1);
        offset = 3;
    } else {
        throw new Error('Unsupported CBOR length encoding');
    }
    if (buffer.length !== offset + length) {
        throw new Error('CBOR byte string length mismatch');
    }
    return buffer.subarray(offset);
}

// `fido2-token -L` lines look like "/dev/hidraw5: vendor=0x1050, product=0x0407 (...)".
function parseDeviceList(stdout) {
    return stdout.split('\n')
        .map(line => line.match(/^(\S+?):\s/))
        .filter(Boolean)
        .map(match => match[1]);
}

// `fido2-token -L -k <rp>` prints one resident credential per line:
// "<index>: <credential id> <user name> <user id> <type> <protection>".
// The user name may be empty or contain spaces, so fields are taken from both ends.
function parseResidentCredentials(stdout) {
    return stdout.split('\n')
        .map(line => line.trim().split(/\s+/))
        .filter(fields => fields.length >= 5 && /^\d+:$/.test(fields[0]))
        .map(fields => ({
            credentialId: Buffer.from(fields[1], 'base64'),
            userHandle: Buffer.from(fields[fields.length - 3], 'base64'),
        }));
}

// fido2-assert -G output: client data hash, rp id, CBOR authenticator data, signature,
// then the user id for a resident credential.
function parseAssertion(stdout, expectedHash) {
    const lines = stdout.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length < 4) {
        throw new Error('Unexpected fido2-assert output');
    }
    if (!Buffer.from(lines[0], 'base64').equals(expectedHash)) {
        throw new Error('fido2-assert answered for a different client data hash');
    }
    return {
        authenticatorData: unwrapCborByteString(Buffer.from(lines[2], 'base64')),
        signature: Buffer.from(lines[3], 'base64'),
        userHandle: lines[4] ? Buffer.from(lines[4], 'base64') : null,
    };
}

// Resident credentials first (usernameless sign-in); when the page names credentials,
// keep only those. Server-side credentials the key does not list are still tried.
function selectCredentials(resident, allowCredentials) {
    if (allowCredentials.length === 0) {
        return resident;
    }
    const matching = resident.filter(cred =>
        allowCredentials.some(id => id.equals(cred.credentialId)));
    if (matching.length > 0) {
        return matching;
    }
    return allowCredentials.map(id => ({credentialId: id, userHandle: null}));
}

// Validates and decodes what the page bridge sent. Everything arrives base64url-encoded.
function parseRequest(request) {
    if (!request || typeof request !== 'object') {
        throw new TypeError('Missing request');
    }
    const challenge = fromBase64Url(request.challenge);
    if (challenge.length < 16) {
        throw new TypeError('Challenge too short');
    }
    const allow = Array.isArray(request.allowCredentials) ? request.allowCredentials : [];
    const timeout = Number.isFinite(request.timeout) && request.timeout > 0
        ? Math.min(request.timeout, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
    return {
        challenge,
        rpId: typeof request.rpId === 'string' ? request.rpId : null,
        allowCredentials: allow.slice(0, 64).map(fromBase64Url),
        timeout,
    };
}

function fidoErrorCode(stderr) {
    const match = /FIDO_ERR_[A-Z_]+/.exec(stderr);
    return match ? match[0] : null;
}

class Fido2Error extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

// The tools are looked up in fixed system directories (the snap's own first), never
// through PATH, which the user's environment controls.
let toolDirectories = [
    process.env.SNAP && path.join(process.env.SNAP, 'usr', 'bin'),
    '/usr/bin',
    '/usr/local/bin',
].filter(Boolean);

function setToolDirectories(directories) {
    toolDirectories = directories;
}

function toolPath(name) {
    return toolDirectories.map(dir => path.join(dir, name)).find(file => fs.existsSync(file)) || null;
}

function isAvailable() {
    return toolPath('fido2-token') !== null && toolPath('fido2-assert') !== null;
}

// Runs a fido2-tools command. The PIN goes to stdin: the tools read it from the
// controlling terminal when there is one, so the child is started in its own session
// (detached) to guarantee it has none, even when the app was launched from a shell.
function run(command, args, {pin = null, timeout = DEFAULT_TIMEOUT_MS} = {}) {
    return new Promise((resolve, reject) => {
        const executable = toolPath(command);
        if (!executable) {
            reject(new Fido2Error(`${command} not found`, 'SPAWN'));
            return;
        }
        const child = spawn(executable, args, {detached: true, stdio: ['pipe', 'pipe', 'pipe']});
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Fido2Error(`${command} timed out`, 'TIMEOUT'));
        }, timeout);

        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.stdin.on('error', () => {});
        child.on('error', error => {
            clearTimeout(timer);
            reject(new Fido2Error(error.message, 'SPAWN'));
        });
        child.on('close', code => {
            clearTimeout(timer);
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Fido2Error(`${command} failed: ${stderr.trim()}`, fidoErrorCode(stderr)));
            }
        });

        child.stdin.end(pin === null ? '' : pin + '\n');
    });
}

async function findDevice() {
    const devices = parseDeviceList(await run('fido2-token', ['-L'], {timeout: 10000}));
    if (devices.length === 0) {
        throw new Fido2Error('No security key detected', 'NO_DEVICE');
    }
    return devices[0];
}

async function listResidentCredentials(device, rpId, pin) {
    try {
        const credentials = parseResidentCredentials(
            await run('fido2-token', ['-L', '-k', rpId, device], {pin, timeout: 30000}));
        console.info(`[WebAuthn] ${credentials.length} resident credential(s) for ${rpId}`);
        return credentials;
    } catch (error) {
        // A key without resident credentials for this RP is not an error.
        if (error.code === 'FIDO_ERR_NO_CREDENTIALS') {
            return [];
        }
        throw error;
    }
}

async function assertWithCredential(device, rpId, clientDataHash, credential, pin, timeout) {
    // The input file holds no secret (hash, RP ID, credential ID); it is still private.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ew-fido2-'));
    const input = path.join(dir, 'assert-param');
    try {
        fs.writeFileSync(input, [
            clientDataHash.toString('base64'),
            rpId,
            credential.credentialId.toString('base64'),
        ].join('\n') + '\n', {mode: 0o600});
        return parseAssertion(
            await run('fido2-assert', ['-G', '-v', '-i', input, device], {pin, timeout}),
            clientDataHash,
        );
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

// Performs navigator.credentials.get() for `origin`. `pin` is the key's PIN;
// `onTouch` is called when the key is waiting for the user's touch.
async function getAssertion(request, origin, pin, onTouch = () => {}) {
    if (!isAllowedOrigin(origin)) {
        throw new Fido2Error(`Origin not allowed: ${origin}`, 'ORIGIN');
    }
    const rpId = request.rpId || new URL(origin).hostname;
    if (!rpIdMatchesOrigin(rpId, origin)) {
        throw new Fido2Error(`RP ID ${rpId} is not valid for ${origin}`, 'RP_ID');
    }

    const device = await findDevice();
    const resident = await listResidentCredentials(device, rpId, pin);
    const candidates = selectCredentials(resident, request.allowCredentials);
    if (candidates.length === 0) {
        throw new Fido2Error(`No credential for ${rpId} on this key`, 'FIDO_ERR_NO_CREDENTIALS');
    }
    if (candidates.length > 1) {
        console.info(`[WebAuthn] ${candidates.length} credentials match; using the first one`);
    }

    const clientDataJSON = buildClientDataJSON(request.challenge, origin);
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
    const credential = candidates[0];

    onTouch();
    const assertion = await assertWithCredential(device, rpId, clientDataHash, credential, pin, request.timeout);

    return {
        id: toBase64Url(credential.credentialId),
        clientDataJSON: toBase64Url(clientDataJSON),
        authenticatorData: toBase64Url(assertion.authenticatorData),
        signature: toBase64Url(assertion.signature),
        userHandle: assertion.userHandle || credential.userHandle
            ? toBase64Url(assertion.userHandle || credential.userHandle) : null,
    };
}

module.exports = {
    Fido2Error,
    buildClientDataJSON,
    getAssertion,
    isAllowedOrigin,
    isAvailable,
    parseAssertion,
    parseDeviceList,
    parseRequest,
    parseResidentCredentials,
    rpIdMatchesOrigin,
    selectCredentials,
    setToolDirectories,
    unwrapCborByteString,
};
