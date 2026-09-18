// Runs page-bridge.js in a simulated main world: fake navigator.credentials and WebAuthn
// classes, and a bridge standing in for the main process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'webauthn', 'page-bridge.js'), 'utf8');

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

function loadBridge(answer) {
    const requests = [];
    class PublicKeyCredential {}
    class AuthenticatorAssertionResponse {}
    const window = {
        PublicKeyCredential,
        __ewFido2: {get: (request) => { requests.push(request); return Promise.resolve(answer); }},
    };
    const navigator = {credentials: {get: () => Promise.resolve('native'), create: () => Promise.resolve('native')}};
    const context = vm.createContext({
        window, navigator, PublicKeyCredential, AuthenticatorAssertionResponse,
        ArrayBuffer, Uint8Array, DOMException, btoa, atob, Promise, TypeError,
    });
    vm.runInContext(SCRIPT, context);
    return {navigator, window, requests, PublicKeyCredential, AuthenticatorAssertionResponse};
}

const RESULT = {
    id: b64url([0xfb, 0xff, 0x01]),
    clientDataJSON: b64url(Buffer.from('{"type":"webauthn.get"}')),
    authenticatorData: b64url([1, 2, 3]),
    signature: b64url([0xfe, 0xfd]),
    userHandle: b64url([9]),
};

test('public-key requests go to the bridge, base64url-encoded', async () => {
    const page = loadBridge(RESULT);
    await page.navigator.credentials.get({publicKey: {
        challenge: new Uint8Array([0xfb, 0xff, 0xfe, 0x3e]).buffer,
        rpId: 'login.microsoft.com',
        timeout: 60000,
        allowCredentials: [{type: 'public-key', id: new Uint8Array([0xff, 0xef])}],
    }});
    // JSON round-trip: objects built inside the vm context carry its own Object prototype.
    assert.deepEqual(JSON.parse(JSON.stringify(page.requests)), [{
        challenge: b64url([0xfb, 0xff, 0xfe, 0x3e]),
        rpId: 'login.microsoft.com',
        timeout: 60000,
        allowCredentials: [b64url([0xff, 0xef])],
    }]);
    assert.equal(page.requests[0].challenge.includes('='), false);
});

test('the answer is rebuilt as a PublicKeyCredential with raw bytes', async () => {
    const page = loadBridge(RESULT);
    const credential = await page.navigator.credentials.get({publicKey: {challenge: new Uint8Array(16)}});
    assert.ok(credential instanceof page.PublicKeyCredential);
    assert.ok(credential.response instanceof page.AuthenticatorAssertionResponse);
    assert.equal(credential.id, RESULT.id);
    assert.equal(credential.type, 'public-key');
    assert.deepEqual([...new Uint8Array(credential.rawId)], [0xfb, 0xff, 0x01]);
    assert.deepEqual([...new Uint8Array(credential.response.signature)], [0xfe, 0xfd]);
    assert.deepEqual([...new Uint8Array(credential.response.userHandle)], [9]);
    assert.equal(credential.toJSON().response.authenticatorData, RESULT.authenticatorData);
});

test('bridge errors and unsupported calls reject with WebAuthn error names', async () => {
    const page = loadBridge({error: 'The operation was cancelled'});
    await assert.rejects(page.navigator.credentials.get({publicKey: {challenge: new Uint8Array(16)}}),
        {name: 'NotAllowedError'});
    await assert.rejects(page.navigator.credentials.get({publicKey: {challenge: new Uint8Array(16)}, mediation: 'conditional'}),
        {name: 'NotSupportedError'});
    await assert.rejects(page.navigator.credentials.create({publicKey: {}}), {name: 'NotSupportedError'});
    assert.equal(await page.navigator.credentials.get({password: true}), 'native');
    assert.equal(await page.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(), false);
});

test('the transport is removed from the page once captured', () => {
    const page = loadBridge(RESULT);
    assert.equal(page.window.__ewFido2, undefined);
});
