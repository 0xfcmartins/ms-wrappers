const { exec, spawnSync } = require('child_process');

/**
 * Camera Activation Module
 * Handles snap permission setup for Microsoft Teams camera and audio access
 */

// Constants for camera activation messages
const ACTIVATION_MESSAGES = {
  HEADER: '═'.repeat(95),
  TITLE: '[CAMERA ACTIVATION] Microsoft Teams - Camera & Audio Permission Setup',
  SEPARATOR: '─'.repeat(95),
  
  INTERFACES: {
    CAMERA: {
      title: '📹 CAMERA INTERFACE (teams-ew:camera)',
      description: [
        '   • Grants access to all connected cameras and webcams',
        '   • Required for video calls, screen sharing, and camera previews',
        '   • Enables camera selection in Teams settings'
      ]
    },
    AUDIO_RECORD: {
      title: '🎤 AUDIO RECORDING INTERFACE (teams-ew:audio-record)',
      description: [
        '   • Grants access to microphones and audio input devices',
        '   • Required for voice calls, meeting participation, and audio recording',
        '   • Enables microphone selection and noise cancellation features'
      ]
    },
    AUDIO_PLAYBACK: {
      title: '🔊 AUDIO PLAYBACK INTERFACE (teams-ew:audio-playback)',
      description: [
        '   • Grants access to speakers and audio output devices',
        '   • Required for hearing other participants in calls and meetings',
        '   • Enables speaker selection and audio routing controls'
      ]
    }
  },

  SECURITY_INFO: [
    '🔒 SECURITY & PRIVACY INFORMATION:',
    '   • These permissions are managed by Ubuntu\'s snap confinement system',
    '   • Only the Microsoft Teams application will have access to these resources',
    '   • Permissions can be revoked at any time using: snap disconnect teams-ew:<interface>',
    '   • No other applications are affected by these permission changes'
  ],

  AUTH_WARNING: [
    '⚠️  ADMINISTRATOR AUTHENTICATION REQUIRED:',
    '   • You will be prompted ONCE for your administrator password',
    '   • All three permission changes will be applied in a single operation',
    '   • The authentication dialog may appear behind this window',
    '   • If authentication fails, you can retry this process at any time'
  ],

  EXECUTION_PHASE: [
    '🔄 [EXECUTION PHASE] Beginning snap interface connection process...',
    '   ➤ Preparing to execute: snap connect teams-ew:camera',
    '   ➤ Preparing to execute: snap connect teams-ew:audio-record',
    '   ➤ Preparing to execute: snap connect teams-ew:audio-playback'
  ],

  AUTH_INSTRUCTIONS: [
    '🔐 [AUTH REQUIRED] Please provide your administrator password when prompted.',
    '   ➤ A system authentication dialog should appear shortly',
    '   ➤ Enter your user account password (the one you use to log in)',
    '   ➤ All three permissions will be granted with a single authentication',
    '   ➤ This process may take 10-30 seconds to complete'
  ],

  SUCCESS: {
    title: '✅ [SUCCESS] Camera & Audio Permissions Activated Successfully!',
    completion: '🎉 ACTIVATION COMPLETE:',
    configured: [
      '📋 WHAT WAS CONFIGURED:',
      '   ✓ Camera access granted (teams-ew:camera connected)',
      '   ✓ Microphone access granted (teams-ew:audio-record connected)',
      '   ✓ Speaker access granted (teams-ew:audio-playback connected)'
    ],
    nextSteps: [
      '🔧 NEXT STEPS:',
      '   • Test your camera and microphone in Teams settings',
      '   • Join a test call to verify audio and video functionality',
      '   • If issues persist, try restarting Microsoft Teams'
    ],
    troubleshooting: [
      '🔧 TROUBLESHOOTING:',
      '   • To check permissions: snap connections teams-ew',
      '   • To remove permissions: snap disconnect teams-ew:<interface>',
      '   • For support, check Teams audio/video settings'
    ]
  },

  ERROR: {
    title: '❌ [ERROR] Camera & Audio Permission Setup Failed',
    incomplete: '⚠️  SETUP INCOMPLETE:',
    troubleshooting: [
      '🔧 TROUBLESHOOTING OPTIONS:',
      '   • Retry: Select "Activate Camera" from the tray menu again',
      '   • Manual: Run commands in terminal with: sudo snap connect teams-ew:camera',
      '   • Check: Verify snap service is running: systemctl status snapd',
      '   • Verify: Your user account has administrator privileges'
    ],
    manualCommands: [
      '💡 MANUAL COMMANDS (if needed):',
      '   sudo snap connect teams-ew:camera',
      '   sudo snap connect teams-ew:audio-record',
      '   sudo snap connect teams-ew:audio-playbook'
    ]
  }
};

const SNAP_COMMANDS = [
  'snap connect teams-ew:camera',
  'snap connect teams-ew:audio-record',
  'snap connect teams-ew:audio-playbook'
];

const ERROR_MESSAGES = {
  AUTHENTICATION_FAILED: 'Authentication was cancelled or failed. The permission setup was not completed. You can try again at any time from the tray menu. Make sure to enter your administrator password when prompted.',
  SETUP_DISMISSED: 'Permission setup was cancelled. No changes were made to your system. You can retry this process at any time by selecting "Activate Camera" from the tray menu.',
  SYSTEM_ERROR: 'Permission setup failed due to a system error. This may be due to snap service issues or insufficient privileges. Error details: {error}. You can retry this process or manually run the commands in a terminal.',
  NO_SUDO_TOOL: 'Unable to find a suitable authentication method on your system. This process requires a GUI authentication tool like pkexec, gksudo, or kdesu. Please install one of these tools or manually run the snap connect commands in a terminal with sudo privileges.',
  SUCCESS_MESSAGE: 'Camera and audio permissions have been successfully activated! Microsoft Teams now has full access to your camera, microphone, and speakers. You can now participate in video calls, voice calls, and use all multimedia features in Teams. If you experience any issues, try restarting the Teams application.'
};

/**
 * Creates the explanation script for camera activation
 * @returns {string} JavaScript code for browser execution
 */
function createExplanationScript() {
  const { INTERFACES, SECURITY_INFO, AUTH_WARNING } = ACTIVATION_MESSAGES;
  
  return `
    (function() {
      try {
        console.log(${JSON.stringify(ACTIVATION_MESSAGES.HEADER)});
        console.log(${JSON.stringify(ACTIVATION_MESSAGES.TITLE)});
        console.log(${JSON.stringify(ACTIVATION_MESSAGES.HEADER)});
        console.log('');
        console.log('[INFO] This process will configure snap security interfaces to enable full');
        console.log('       multimedia functionality in Microsoft Teams. The following system-level');
        console.log('       permissions will be granted to the teams-ew snap package:');
        console.log('');
        
        // Log interface information
        console.log(${JSON.stringify(INTERFACES.CAMERA.title)});
        ${INTERFACES.CAMERA.description.map(line => `console.log(${JSON.stringify(line)});`).join('\n        ')}
        console.log('');
        
        console.log(${JSON.stringify(INTERFACES.AUDIO_RECORD.title)});
        ${INTERFACES.AUDIO_RECORD.description.map(line => `console.log(${JSON.stringify(line)});`).join('\n        ')}
        console.log('');
        
        console.log(${JSON.stringify(INTERFACES.AUDIO_PLAYBACK.title)});
        ${INTERFACES.AUDIO_PLAYBACK.description.map(line => `console.log(${JSON.stringify(line)});`).join('\n        ')}
        console.log('');
        
        // Log security information
        ${SECURITY_INFO.map(line => `console.log(${JSON.stringify(line)});`).join('\n        ')}
        console.log('');
        
        // Log authentication warning
        ${AUTH_WARNING.map(line => `console.log(${JSON.stringify(line)});`).join('\n        ')}
        console.log('');
        
        console.log('[STATUS] Initializing permission activation process...');
        console.log(${JSON.stringify(ACTIVATION_MESSAGES.SEPARATOR)});
        
        // Signal to main process
        if (window.electronAPI && window.electronAPI.send) {
          window.electronAPI.send('proceed-camera-activation');
        } else {
          console.log('[CAMERA ACTIVATION] IPC not available, using fallback');
        }
        
        return true;
      } catch (error) {
        console.error('[CAMERA ACTIVATION] Script error:', error);
        return false;
      }
    })();
  `;
}

/**
 * Creates the progress notification script
 * @returns {string} JavaScript code for browser execution
 */
function createProgressScript() {
  const { EXECUTION_PHASE, AUTH_INSTRUCTIONS, SEPARATOR } = ACTIVATION_MESSAGES;
  
  return `
    console.log('');
    ${EXECUTION_PHASE.map(line => `console.log(${JSON.stringify(line)});`).join('\n    ')}
    console.log('');
    ${AUTH_INSTRUCTIONS.map(line => `console.log(${JSON.stringify(line)});`).join('\n    ')}
    console.log('');
    console.log('⏳ [WAITING] Please wait for the authentication prompt...');
    console.log(${JSON.stringify(SEPARATOR)});
  `;
}

/**
 * Creates the success result script
 * @param {string} message - Success message
 * @returns {string} JavaScript code for browser execution
 */
function createSuccessScript(message) {
  const { SUCCESS, HEADER, SEPARATOR } = ACTIVATION_MESSAGES;
  
  return `
    console.log('');
    console.log(${JSON.stringify(HEADER)});
    console.log(${JSON.stringify(SUCCESS.title)});
    console.log(${JSON.stringify(HEADER)});
    console.log('');
    console.log(${JSON.stringify(SUCCESS.completion)});
    console.log('   ' + ${JSON.stringify(message)});
    console.log('');
    ${SUCCESS.configured.map(line => `console.log(${JSON.stringify(line)});`).join('\n    ')}
    console.log('');
    ${SUCCESS.nextSteps.map(line => `console.log(${JSON.stringify(line)});`).join('\n    ')}
    console.log('');
    ${SUCCESS.troubleshooting.map(line => `console.log(${JSON.stringify(line)});`).join('\n    ')}
    console.log('');
    console.log(${JSON.stringify(SEPARATOR)});
  `;
}

/**
 * Creates the error result script
 * @param {string} message - Error message
 * @returns {string} JavaScript code for browser execution
 */
function createErrorScript(message) {
  const { ERROR, HEADER, SEPARATOR } = ACTIVATION_MESSAGES;
  
  return `
    console.log('');
    console.log(${JSON.stringify(HEADER)});
    console.log(${JSON.stringify(ERROR.title)});
    console.log(${JSON.stringify(HEADER)});
    console.log('');
    console.log(${JSON.stringify(ERROR.incomplete)});
    console.log('   ' + ${JSON.stringify(message)});
    console.log('');
    ${ERROR.troubleshooting.map(line => `console.log(${JSON.stringify(line)});`).join('\n    ')}
    console.log('');
    ${ERROR.manualCommands.map(line => `console.log(${JSON.stringify(line)});`).join('\n    ')}
    console.log('');
    console.log(${JSON.stringify(SEPARATOR)});
  `;
}

/**
 * Detects the best available GUI sudo tool for the system
 * @returns {string} The command prefix to use for GUI sudo
 */
function detectSudoTool() {
  const tools = ['pkexec', 'gksudo', 'kdesu'];
  
  for (const tool of tools) {
    const result = spawnSync('which', [tool], {
      stdio: 'ignore',
      encoding: 'utf8' 
    });
    
    if (result.status === 0) {
      console.log(`Found GUI sudo tool: ${tool}`);
      return tool;
    } else {
      console.warn(`GUI sudo tool not found: ${tool}`);
    }
  }
  
  console.warn('No GUI sudo tool found, falling back to terminal sudo');
  return 'sudo';
}

/**
 * Shows camera activation explanation to the user
 * @param {BrowserWindow} mainWindow - The main application window
 * @param {Function} proceedCallback - Callback to call when user proceeds
 */
function showActivationExplanation(mainWindow, proceedCallback) {
  console.log('[MAIN] Attempting to show camera activation dialog...');
  
  // Ensure the main window is visible and focused
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  
  // Wait a moment for the window to be ready
  setTimeout(() => {
    console.log('[MAIN] Main window focused, showing explanation...');
    
    mainWindow.webContents.executeJavaScript(createExplanationScript())
      .then(result => {
        console.log('[MAIN] Explanation script executed:', result);
        if (!result) {
          console.log('[MAIN] Script failed, proceeding with fallback...');
          proceedCallback(mainWindow);
        }
      })
      .catch(err => {
        console.error('[MAIN] Error showing explanation:', err);
        console.log('[MAIN] Proceeding directly...');
        proceedCallback(mainWindow);
      });
  }, 100);
}

/**
 * Shows progress notification to the user
 * @param {BrowserWindow} mainWindow - The main application window
 */
function showProgress(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(createProgressScript())
      .catch(err => console.error('Error showing progress:', err));
  }
}

/**
 * Executes snap connect commands with GUI sudo
 * @param {BrowserWindow} mainWindow - The main application window
 * @param {Function} resultCallback - Callback for showing results
 */
async function executeSnapCommands(mainWindow, resultCallback) {
  console.log('Proceeding with camera and audio permissions activation...');
  showProgress(mainWindow);

  try {
    const sudoTool = await detectSudoTool();
    const combinedCommand = SNAP_COMMANDS.join(' && ');
    const fullCommand = `${sudoTool} sh -c "${combinedCommand}"`;
    
    console.log(`Executing all commands with single sudo: ${fullCommand}`);

    exec(fullCommand, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Error executing combined commands:', error.message);
        
        // Handle specific error types
        let errorMessage = ERROR_MESSAGES.SYSTEM_ERROR.replace('{error}', error.message);
        
        if (error.message.includes('authentication') || error.message.includes('cancelled')) {
          errorMessage = ERROR_MESSAGES.AUTHENTICATION_FAILED;
        } else if (error.message.includes('dismissed')) {
          errorMessage = ERROR_MESSAGES.SETUP_DISMISSED;
        }
        
        resultCallback(mainWindow, false, errorMessage);
        return;
      }

      if (stderr) {
        console.warn('Warnings from combined commands:', stderr);
      }

      if (stdout) {
        console.log('Output from combined commands:', stdout);
      }

      // Success
      console.log('All camera and audio permissions activated successfully');
      resultCallback(mainWindow, true, ERROR_MESSAGES.SUCCESS_MESSAGE);
    });
  } catch (error) {
    console.error('Failed to detect sudo tool:', error);
    resultCallback(mainWindow, false, ERROR_MESSAGES.NO_SUDO_TOOL);
  }
}

/**
 * Shows activation result to the user
 * @param {BrowserWindow} mainWindow - The main application window
 * @param {boolean} success - Whether activation was successful
 * @param {string} message - Message to display
 */
function showActivationResult(mainWindow, success, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const script = success ? createSuccessScript(message) : createErrorScript(message);
    
    mainWindow.webContents.executeJavaScript(script)
      .catch(err => console.error('Error showing activation result:', err));
  }
}

/**
 * Main entry point for camera activation
 * @param {BrowserWindow} mainWindow - The main application window
 */
function activateCameraPermissions(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.error('Main window not available for camera activation');
    return;
  }

  // Show explanation first, then proceed to execution
  showActivationExplanation(mainWindow, () => {
    executeSnapCommands(mainWindow, showActivationResult);
  });
}

module.exports = {
  activateCameraPermissions,
  executeSnapCommands,
  showActivationResult
};