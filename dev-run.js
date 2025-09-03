// dev-run.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const appName = process.argv[2] || 'teams';
const appDir = path.join(__dirname, 'apps', appName);
const tempDir = path.join(__dirname, 'temp', appName);

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Create main and preload directories
const mainDir = path.join(tempDir, 'main');
const preloadDir = path.join(tempDir, 'preload');

fs.mkdirSync(mainDir, { recursive: true });
fs.mkdirSync(preloadDir, { recursive: true });

// Copy source files to correct locations
fs.cpSync(path.join(__dirname, 'src', 'main'), mainDir, { recursive: true });
fs.cpSync(path.join(__dirname, 'src', 'preload'), preloadDir, { recursive: true });

// Copy screen sharing module
const displayCaptureDir = path.join(tempDir, 'display-capture');
fs.mkdirSync(displayCaptureDir, { recursive: true });
fs.cpSync(path.join(__dirname, 'src', 'display-capture'), displayCaptureDir, { recursive: true });

// Copy preview module
const previewDir = path.join(tempDir, 'preview');
fs.mkdirSync(previewDir, { recursive: true });
fs.cpSync(path.join(__dirname, 'src', 'preview'), previewDir, { recursive: true });

// Copy security module
const securityDir = path.join(tempDir, 'security');
fs.mkdirSync(securityDir, { recursive: true });
fs.cpSync(path.join(__dirname, 'src', 'security'), securityDir, { recursive: true });

// Copy icons to correct location
if (fs.existsSync(path.join(appDir, 'icons'))) {
  fs.cpSync(path.join(appDir, 'icons'), path.join(tempDir, 'icons'), { recursive: true });
}

fs.copyFileSync(path.join(__dirname, 'src', 'main.js'), path.join(tempDir, 'main.js'));

// Create config and package files
const config = JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8'));
fs.writeFileSync(path.join(tempDir, 'app-config.json'), JSON.stringify(config, null, 2));

const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

console.log(`Running ${appName} in development mode...`);
const electron = spawn('npx', ['electron', '--enable-unsafe-swiftshader', tempDir], { stdio: 'inherit' });

electron.on('close', (code) => {
  console.log(`Electron process exited with code ${code}`);
});