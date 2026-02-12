// Environment and platform configuration
const path = require('path');

function detectEnvironmentCapabilities() {
    const isSnap = !!(process.env.SNAP || process.env.SNAPCRAFT_PROJECT_NAME);
    return {
        hasHardwareAcceleration: process.env.DISABLE_GPU !== 'true' &&
            !isSnap &&
            !(process.env.SSH_CLIENT || process.env.SSH_TTY || !process.env.DISPLAY),
        displayServer: process.env.XDG_SESSION_TYPE || 'x11',
        isContainer: !!process.env.container,
        isSnap: isSnap
    };
}

function applyEnvironment(app, appConfig) {
    // Determine Snap environment
    const isSnap = process.env.SNAP || process.env.SNAPCRAFT_PROJECT_NAME;

    // Default
    let shouldDisableHardwareAcceleration;

    if (isSnap) {
        console.info('Running in Snap environment, applying Snap-specific configurations...');

        // Snap-specific environment setup
        app.commandLine.appendSwitch('no-sandbox');
        app.commandLine.appendSwitch('disable-dev-shm-usage');
        app.commandLine.appendSwitch('disable-setuid-sandbox');

        // Use user data directory for temporary files in Snap
        if (process.env.SNAP_USER_DATA) {
            const tmpDir = path.join(process.env.SNAP_USER_DATA, 'tmp');
            try {
                // Use restricted permissions (0700) for the temporary directory
                // to ensure only the current user can access it (Sonar S5443)
                require('fs').mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
                process.env.TMPDIR = tmpDir;
            } catch (error) {
                console.warn('[Snap] Could not create temp directory:', error.message);
            }
        }

        // Ensure D-Bus access in Snap environment
        if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
            console.warn('[Snap] D-Bus session not available, some features may be limited');
        }

        // Always disable hardware acceleration in Snap to avoid graphics issues
        shouldDisableHardwareAcceleration = true;
        console.info('Disabling hardware acceleration for Snap environment');
        app.disableHardwareAcceleration();
        app.commandLine.appendSwitch('disable-gpu');
        app.commandLine.appendSwitch('disable-gpu-rasterization');
        app.commandLine.appendSwitch('disable-gpu-compositing');
        app.commandLine.appendSwitch('disable-software-rasterizer');
        app.commandLine.appendSwitch('use-gl', 'swiftshader');
        app.commandLine.appendSwitch('enable-unsafe-swiftshader');
    } else {
        // Only disable hardware acceleration in specific problematic environments for non-Snap
        shouldDisableHardwareAcceleration = (
            process.env.SSH_CLIENT ||
            process.env.SSH_TTY ||
            !process.env.DISPLAY ||
            process.env.DISABLE_GPU === 'true'
        );

        if (shouldDisableHardwareAcceleration) {
            console.info('Disabling hardware acceleration due to environment constraints');
            app.disableHardwareAcceleration();
            app.commandLine.appendSwitch('disable-gpu');
            app.commandLine.appendSwitch('disable-gpu-rasterization');
            app.commandLine.appendSwitch('disable-gpu-compositing');
            app.commandLine.appendSwitch('disable-zero-copy');
            app.commandLine.appendSwitch('disable-software-rasterizer');
            app.commandLine.appendSwitch('use-gl', 'swiftshader');
            app.commandLine.appendSwitch('enable-unsafe-swiftshader');
        } else {
            console.info('Hardware acceleration enabled');
        }
    }

    if (process.platform === 'linux') {
        // Wayland support
        if (process.env.XDG_SESSION_TYPE === 'wayland') {
            if (shouldDisableHardwareAcceleration) {
                console.info('Wayland detected with hardware acceleration disabled. Using software rendering without Ozone Wayland to avoid EGL errors.');
            } else {
                app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform,WebRTCPipeWireCapturer');
                app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
            }
        }

        // Add Linux-specific flags for better compatibility
        if (!isSnap) {
            // Only add these for non-Snap environments since Snap handles sandboxing differently
            app.commandLine.appendSwitch('no-sandbox');
            app.commandLine.appendSwitch('disable-dev-shm-usage');
        }

        // Always add these flags for Snap or when hardware acceleration is disabled
        if (isSnap || shouldDisableHardwareAcceleration) {
            app.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder');
            app.commandLine.appendSwitch('ignore-gpu-blacklist');
        }

        // Snap-specific display handling
        if (isSnap) {
            // Force X11 in Snap environment
            app.commandLine.appendSwitch('use-gl', 'swiftshader');
            app.commandLine.appendSwitch('ignore-certificate-errors');

            // Ensure DISPLAY is set
            if (!process.env.DISPLAY) {
                process.env.DISPLAY = ':0';
                console.info('Set DISPLAY to :0 for Snap environment');
            }
        }
    }

    app.commandLine.appendSwitch('disable-features', 'InPrivateMode');
    app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

    // Environment-aware media flags - Wayland-specific optimization for Linux desktop environments
    // PipeWire provides better screen sharing and audio capture on Wayland
    if (process.platform === 'linux') {
        // Detect display server type
        const displayServer = process.env.XDG_SESSION_TYPE || 'x11';
        console.info(`Running on ${displayServer} display server`);

        if (displayServer === 'wayland') {
            console.info('Running under Wayland, enabling PipeWire support...');

            const features = app.commandLine.hasSwitch('enable-features')
                ? app.commandLine.getSwitchValue('enable-features').split(',')
                : ['WebRTC-H264WithOpenH264FFFmpeg'];

            if (!features.includes('WebRTCPipeWireCapturer')) {
                features.push('WebRTCPipeWireCapturer');
            }

            app.commandLine.appendSwitch('enable-features', features.join(','));
            app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
        } else {
            // X11 or Snap environment
            app.commandLine.appendSwitch('enable-features', 'WebRTC-H264WithOpenH264FFFmpeg');
        }

        // Ensure DISPLAY is set for X11 applications
        if (!process.env.DISPLAY && displayServer !== 'wayland') {
            console.warn('DISPLAY environment variable not set. This may cause issues with X11 applications.');
            // Try to set a default display
            process.env.DISPLAY = ':0';
        }
    } else {
        // Non-Linux environments: enable H264 support only
        app.commandLine.appendSwitch('enable-features', 'WebRTC-H264WithOpenH264FFFmpeg');
    }

    // WebRTC logs only in development mode
    if (process.env.NODE_ENV === 'development') {
        app.commandLine.appendSwitch('enable-webrtc-logs');
    }

    if (process.platform === 'win32') {
        app.setAppUserModelId(appConfig.name);
    }

    // Get environment capabilities for logging
    const capabilities = detectEnvironmentCapabilities();
    console.info('[Environment] Capabilities:', capabilities);

    return { isSnap, shouldDisableHardwareAcceleration, capabilities };
}

module.exports = { applyEnvironment, detectEnvironmentCapabilities };