const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

const fido2 = require('../../src/main/webauthn/fido2');

const FAKE_BIN = path.join(__dirname, 'fake-bin');

// The fake fido2-tools replace any real ones installed on the machine.
test.beforeEach(() => fido2.setToolDirectories([FAKE_BIN]));

const ORIGIN = 'https://login.microsoft.com';
const CHALLENGE = crypto.randomBytes(32);

function request(overrides = {}) {
    return fido2.parseRequest({
        challenge: CHALLENGE.toString('base64url'),
        rpId: 'login.microsoft.com',
        timeout: 10000,
        ...overrides,
    });
}

test('only Microsoft sign-in origins may run a ceremony', () => {
    assert.equal(fido2.isAllowedOrigin(ORIGIN), true);
    assert.equal(fido2.isAllowedOrigin('https://login.microsoftonline.com'), true);
    assert.equal(fido2.isAllowedOrigin('https://outlook.office.com'), false);
    assert.equal(fido2.isAllowedOrigin('http://login.microsoft.com'), false);
    assert.equal(fido2.isAllowedOrigin('https://login.microsoft.com.evil.example'), false);
});

test('the RP ID must be the origin host or a label-aligned suffix of it', () => {
    assert.equal(fido2.rpIdMatchesOrigin('login.microsoft.com', ORIGIN), true);
    assert.equal(fido2.rpIdMatchesOrigin('microsoft.com', ORIGIN), true);
    assert.equal(fido2.rpIdMatchesOrigin('soft.com', ORIGIN), false);
    assert.equal(fido2.rpIdMatchesOrigin('com', ORIGIN), false);
    assert.equal(fido2.rpIdMatchesOrigin('.microsoft.com', ORIGIN), false);
    assert.equal(fido2.rpIdMatchesOrigin('example.com', ORIGIN), false);
});

test('client data follows the WebAuthn serialization', () => {
    const json = fido2.buildClientDataJSON(Buffer.from([0xfb, 0xff]), ORIGIN).toString('utf8');
    assert.equal(json, '{"type":"webauthn.get","challenge":"-_8","origin":"https://login.microsoft.com","crossOrigin":false}');
});

test('CBOR byte strings are unwrapped for every length encoding', () => {
    assert.deepEqual(fido2.unwrapCborByteString(Buffer.from([0x42, 1, 2])), Buffer.from([1, 2]));
    const medium = Buffer.alloc(37, 7);
    assert.deepEqual(fido2.unwrapCborByteString(Buffer.concat([Buffer.from([0x58, 37]), medium])), medium);
    const long = Buffer.alloc(300, 9);
    assert.deepEqual(fido2.unwrapCborByteString(Buffer.concat([Buffer.from([0x59, 0x01, 0x2c]), long])), long);
    assert.throws(() => fido2.unwrapCborByteString(Buffer.from([0x62, 0x61, 0x62])), /not a CBOR byte string/);
    assert.throws(() => fido2.unwrapCborByteString(Buffer.from([0x58, 5, 1])), /length mismatch/);
});

test('device and resident credential listings are parsed', () => {
    assert.deepEqual(fido2.parseDeviceList(
        '/dev/hidraw5: vendor=0x1050, product=0x0407 (Yubico YubiKey OTP+FIDO+CCID)\n'), ['/dev/hidraw5']);
    assert.deepEqual(fido2.parseDeviceList(''), []);

    const creds = fido2.parseResidentCredentials(
        '00: q83vASNFZ4k= Jane Doe dXNlcg== es256 uvopt+id\n01: AQI= (null) AwQ= eddsa uvopt+id\n');
    assert.equal(creds.length, 2);
    assert.deepEqual(creds[0].credentialId, Buffer.from('q83vASNFZ4k=', 'base64'));
    assert.deepEqual(creds[0].userHandle, Buffer.from('user'));
    assert.deepEqual(creds[1].userHandle, Buffer.from([3, 4]));
});

test('credentials named by the page win; unknown ones are still tried', () => {
    const resident = [{credentialId: Buffer.from([1])}, {credentialId: Buffer.from([2])}];
    assert.equal(fido2.selectCredentials(resident, []).length, 2);
    assert.deepEqual(fido2.selectCredentials(resident, [Buffer.from([2])]), [resident[1]]);
    assert.deepEqual(fido2.selectCredentials(resident, [Buffer.from([9])]),
        [{credentialId: Buffer.from([9]), userHandle: null}]);
});

test('requests are validated before touching the key', () => {
    assert.throws(() => fido2.parseRequest(null), /Missing request/);
    assert.throws(() => fido2.parseRequest({challenge: 'AAAA'}), /too short/);
    assert.throws(() => fido2.parseRequest({challenge: 'not base64!'}), /Invalid base64url/);
    assert.equal(request({timeout: 10 ** 9}).timeout, 300000);
    assert.equal(request({timeout: undefined}).timeout, 120000);
});

test('an assertion for a different client data hash is rejected', () => {
    const output = [crypto.randomBytes(32).toString('base64'), 'rp', 'QgEC', 'c2ln'].join('\n');
    assert.throws(() => fido2.parseAssertion(output, crypto.randomBytes(32)), /different client data hash/);
});

test('getAssertion drives fido2-tools end to end', async () => {
    let touched = false;
    const result = await fido2.getAssertion(request(), ORIGIN, '1234', () => { touched = true; });

    assert.equal(touched, true);
    assert.equal(result.id, Buffer.from('q83vASNFZ4k=', 'base64').toString('base64url'));
    assert.equal(result.userHandle, Buffer.from('user-handle').toString('base64url'));
    assert.deepEqual(Buffer.from(result.authenticatorData, 'base64url'), Buffer.from([...Array(37).keys()]));
    assert.equal(result.signature, Buffer.from('MEUCIQDsaWduYXR1cmU=', 'base64').toString('base64url'));

    const clientData = JSON.parse(Buffer.from(result.clientDataJSON, 'base64url').toString('utf8'));
    assert.equal(clientData.challenge, CHALLENGE.toString('base64url'));
    assert.equal(clientData.origin, ORIGIN);
});

test('a wrong PIN surfaces as FIDO_ERR_PIN_INVALID', async () => {
    await assert.rejects(fido2.getAssertion(request(), ORIGIN, '0000'), {code: 'FIDO_ERR_PIN_INVALID'});
});

test('a key without credentials for the RP is reported as such', async () => {
    await assert.rejects(
        fido2.getAssertion(request({rpId: 'microsoft.com'}), ORIGIN, '1234'),
        {code: 'FIDO_ERR_NO_CREDENTIALS'});
});

test('ceremonies for other origins or foreign RP IDs never reach the key', async () => {
    await assert.rejects(fido2.getAssertion(request(), 'https://outlook.office.com', '1234'), {code: 'ORIGIN'});
    await assert.rejects(fido2.getAssertion(request({rpId: 'example.com'}), ORIGIN, '1234'), {code: 'RP_ID'});
});

test('the tools are never resolved through PATH', async () => {
    const savedPath = process.env.PATH;
    process.env.PATH = `${FAKE_BIN}${path.delimiter}${savedPath}`;
    try {
        fido2.setToolDirectories([path.join(__dirname, 'no-such-dir')]);
        assert.equal(fido2.isAvailable(), false);
        await assert.rejects(fido2.getAssertion(request(), ORIGIN, '1234'), {code: 'SPAWN'});
    } finally {
        process.env.PATH = savedPath;
    }
});

test('the tools are available once found in a fixed directory', () => {
    assert.equal(fido2.isAvailable(), true);
});
