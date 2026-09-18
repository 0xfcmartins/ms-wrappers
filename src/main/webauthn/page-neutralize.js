// Runs in a page's MAIN world when no security-key backend is available (or the origin
// is not a sign-in page). Electron ships no WebAuthn implementation (electron/electron#24573),
// yet window.PublicKeyCredential is defined, so Entra advertises passkeys and may
// auto-select one; navigator.credentials.get({publicKey}) then never settles and the
// sign-in page deadlocks. Advertise the truth so the server falls back to another method.
(() => {
    try {
        const creds = navigator.credentials;
        if (creds) {
            const get = creds.get?.bind(creds);
            const create = creds.create?.bind(creds);
            const unsupported = () => Promise.reject(
                new DOMException('WebAuthn is not implemented in Electron', 'NotSupportedError'));

            // Only public-key requests are refused; password credentials keep working.
            creds.get = (options) => options?.publicKey ? unsupported() : get(options);
            creds.create = (options) => options?.publicKey ? unsupported() : create(options);
        }

        delete window.PublicKeyCredential;
        delete window.AuthenticatorAssertionResponse;
        delete window.AuthenticatorAttestationResponse;
    } catch {
        // Never block page start-up over this.
    }
})();
