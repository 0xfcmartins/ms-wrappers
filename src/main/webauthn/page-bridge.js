// Runs in the sign-in page's MAIN world (injected by the preload through
// webFrame.executeJavaScript). Replaces navigator.credentials.get() for public-key
// requests with a call to the main process, which drives the security key through
// fido2-tools, then rebuilds a PublicKeyCredential-shaped result for the page.
//
// The preload exposes the transport as window.__ewFido2 before this runs.
(() => {
    const bridge = window.__ewFido2;
    try {
        delete window.__ewFido2;
    } catch {
        // contextBridge may define it non-configurable; it stays harmless.
    }
    const creds = navigator.credentials;
    if (!bridge || !creds || typeof window.PublicKeyCredential !== 'function') {
        return;
    }

    const toBytes = (source) => {
        if (source instanceof ArrayBuffer) {
            return new Uint8Array(source);
        }
        if (ArrayBuffer.isView(source)) {
            return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        }
        throw new TypeError('Expected a BufferSource');
    };

    const toBase64Url = (source) => {
        let binary = '';
        for (const byte of toBytes(source)) {
            binary += String.fromCharCode(byte);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };

    const fromBase64Url = (text) => {
        const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    };

    const fail = (name, message) => Promise.reject(new DOMException(message, name));

    // Own data properties shadow the prototype's accessors, so the objects keep their
    // real prototypes (instanceof checks pass) while carrying our values.
    const buildCredential = (result) => {
        const response = Object.create(AuthenticatorAssertionResponse.prototype);
        Object.defineProperties(response, {
            clientDataJSON: {value: fromBase64Url(result.clientDataJSON), enumerable: true},
            authenticatorData: {value: fromBase64Url(result.authenticatorData), enumerable: true},
            signature: {value: fromBase64Url(result.signature), enumerable: true},
            userHandle: {value: result.userHandle ? fromBase64Url(result.userHandle) : null, enumerable: true},
        });

        const credential = Object.create(PublicKeyCredential.prototype);
        Object.defineProperties(credential, {
            id: {value: result.id, enumerable: true},
            rawId: {value: fromBase64Url(result.id), enumerable: true},
            type: {value: 'public-key', enumerable: true},
            authenticatorAttachment: {value: 'cross-platform', enumerable: true},
            response: {value: response, enumerable: true},
            getClientExtensionResults: {value: () => ({})},
            toJSON: {
                value: () => ({
                    id: result.id,
                    rawId: result.id,
                    type: 'public-key',
                    authenticatorAttachment: 'cross-platform',
                    clientExtensionResults: {},
                    response: {
                        clientDataJSON: result.clientDataJSON,
                        authenticatorData: result.authenticatorData,
                        signature: result.signature,
                        userHandle: result.userHandle,
                    },
                }),
            },
        });
        return credential;
    };

    const nativeGet = creds.get.bind(creds);
    const nativeCreate = creds.create.bind(creds);

    creds.get = (options) => {
        if (!options || !options.publicKey) {
            return nativeGet(options);
        }
        // No autofill UI to offer: isConditionalMediationAvailable() reports false.
        if (options.mediation === 'conditional') {
            return fail('NotSupportedError', 'Conditional mediation is not supported');
        }
        if (options.signal && options.signal.aborted) {
            return fail('AbortError', 'The operation was aborted');
        }

        let request;
        try {
            const pk = options.publicKey;
            request = {
                challenge: toBase64Url(pk.challenge),
                rpId: pk.rpId,
                timeout: pk.timeout,
                allowCredentials: (pk.allowCredentials || [])
                    .filter(c => c.type === 'public-key')
                    .map(c => toBase64Url(c.id)),
            };
        } catch (error) {
            return fail('TypeError', error.message);
        }

        const ceremony = bridge.get(request).then(result => {
            if (!result || result.error) {
                throw new DOMException(result ? result.error : 'No result', 'NotAllowedError');
            }
            return buildCredential(result);
        });

        if (!options.signal) {
            return ceremony;
        }
        return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted', 'AbortError'));
            }, {once: true});
            ceremony.then(resolve, reject);
        });
    };

    // Registration stays unsupported: enrol keys from a regular browser.
    creds.create = (options) => (options && options.publicKey)
        ? fail('NotSupportedError', 'Security key registration is not supported in this app')
        : nativeCreate(options);

    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
})();
