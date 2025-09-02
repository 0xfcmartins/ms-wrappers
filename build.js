const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const appName = process.argv[2] || 'teams';

// Security: Validate appName to prevent directory traversal and command injection
if (!appName || typeof appName !== 'string') {
  console.error('Invalid app name provided!');
  process.exit(1);
}

// Security: Only allow alphanumeric characters, hyphens, and underscores
if (!/^[a-zA-Z0-9_-]+$/.test(appName)) {
  console.error(`Invalid app name "${appName}". Only alphanumeric characters, hyphens, and underscores are allowed.`);
  process.exit(1);
}

// Security: Resolve paths to prevent directory traversal attacks
const appDir = path.resolve(__dirname, 'apps', appName);
const expectedAppsDir = path.resolve(__dirname, 'apps');

// Security: Ensure the resolved appDir is within the expected apps directory
if (!appDir.startsWith(expectedAppsDir + path.sep)) {
  console.error(`Security violation: App directory "${appDir}" is outside the allowed apps directory.`);
  process.exit(1);
}

if (!fs.existsSync(appDir)) {
  console.error(`App "${appName}" not found in apps directory!`);
  process.exit(1);
}

// Security: Resolve buildDir path to prevent directory traversal
const buildDir = path.resolve(__dirname, 'build', appName);
const expectedBuildDir = path.resolve(__dirname, 'build');

// Security: Ensure the resolved buildDir is within the expected build directory
if (!buildDir.startsWith(expectedBuildDir + path.sep)) {
  console.error(`Security violation: Build directory "${buildDir}" is outside the allowed build directory.`);
  process.exit(1);
}

if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Security: Replace vulnerable execSync with secure fs operations
console.log('Copying source files...');
const srcDir = path.resolve(__dirname, 'src');
try {
  // Copy all files from src directory to buildDir
  const srcItems = fs.readdirSync(srcDir);
  for (const item of srcItems) {
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(buildDir, item);
    const stat = fs.statSync(srcPath);
    
    if (stat.isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  
  // Copy icons directory
  const iconsDir = path.join(appDir, 'icons');
  if (fs.existsSync(iconsDir)) {
    console.log('Copying icons...');
    fs.cpSync(iconsDir, path.join(buildDir, 'icons'), { recursive: true });
  }
  
  // Copy snap directory  
  const snapDir = path.join(appDir, 'snap');
  if (fs.existsSync(snapDir)) {
    console.log('Copying snap configuration...');
    fs.cpSync(snapDir, path.join(buildDir, 'snap'), { recursive: true });
  }
} catch (error) {
  console.error('Error copying files:', error.message);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8'));
fs.writeFileSync(path.join(buildDir, 'app-config.json'), JSON.stringify(config, null, 2));

const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify(packageJson, null, 2));

const snapcraftTemplate = fs.readFileSync(path.join(__dirname, 'snapcraft.yaml.template'), 'utf8');
const snapcraftYaml = snapcraftTemplate
  .replace(/{{APP_NAME}}/g, config.snapName)
  .replace(/{{APP_DESCRIPTION}}/g, config.snapDescription)
  .replace(/{{DESKTOP_NAME}}/g, config.desktopName)
  .replace(/{{DESKTOP_CATEGORIES}}/g, config.desktopCategories);

fs.writeFileSync(path.join(buildDir, 'snapcraft.yaml'), snapcraftYaml);

// Add this line to log the path
console.log(`Generated snapcraft.yaml at ${path.join(buildDir, 'snapcraft.yaml')}`);

console.log(`Building ${appName}...`);
execSync('npm install', { cwd: buildDir, stdio: 'inherit' });

console.log(`Building snap for ${appName}...`);
execSync('electron-builder --linux snap', { cwd: buildDir, stdio: 'inherit' });

console.log(`Build complete! Snap file is in ${buildDir}`);