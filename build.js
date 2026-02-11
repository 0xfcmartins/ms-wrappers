const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const appName = process.argv[2] || 'teams';
const appDir = path.join(__dirname, 'apps', appName);

if (!fs.existsSync(appDir)) {
  console.error(`App "${appName}" not found in apps directory!`);
  process.exit(1);
}

const buildDir = path.join(__dirname, 'build', appName);
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Copy source files to build directory
console.log('Copying source files...');
execSync(`cp -r ${path.join(__dirname, 'src')}/* ${buildDir}`, { stdio: 'inherit' });
execSync(`cp -r ${path.join(appDir, 'icons')} ${buildDir}`, { stdio: 'inherit' });

// Copy snap directory if it exists
if (fs.existsSync(path.join(appDir, 'snap'))) {
  execSync(`cp -r ${path.join(appDir, 'snap')} ${buildDir}`, { stdio: 'inherit' });
}

// Copy desktop file to expected snap location
const snapDir = path.join(buildDir, 'snap');
if (!fs.existsSync(snapDir)) {
  fs.mkdirSync(snapDir, { recursive: true });
}

const guiDir = path.join(snapDir, 'gui');
if (!fs.existsSync(guiDir)) {
  fs.mkdirSync(guiDir, { recursive: true });
}

// Read configuration
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

// Copy desktop file to proper location for Snap
const desktopFileName = `${config.snapName}.desktop`;
const desktopSourcePath = path.join(appDir, 'snap', desktopFileName);
if (fs.existsSync(desktopSourcePath)) {
  // Copy desktop file to snap/gui directory
  fs.copyFileSync(desktopSourcePath, path.join(guiDir, desktopFileName));
  
  // Also copy to root for snap build process
  const snapDesktopPath = path.join(buildDir, 'snap', 'gui', desktopFileName);
  if (!fs.existsSync(snapDesktopPath)) {
    fs.copyFileSync(desktopSourcePath, snapDesktopPath);
  }
}

// Copy icons to Snap GUI directory if they exist
const iconFileName = config.iconFile;
const iconSourcePath = path.join(buildDir, 'icons', iconFileName);
if (fs.existsSync(iconSourcePath)) {
  const iconExtension = path.extname(iconFileName);
  const snapIconFileName = `${config.snapName}${iconExtension}`;
  fs.copyFileSync(iconSourcePath, path.join(guiDir, snapIconFileName));
}

console.log(`Generated snapcraft.yaml at ${path.join(buildDir, 'snapcraft.yaml')}`);

console.log(`Building ${appName}...`);
try {
  execSync('npm install', { cwd: buildDir, stdio: 'inherit' });
} catch (error) {
  console.error('npm install failed:', error.message);
  process.exit(1);
}

console.log(`Building snap for ${appName}...`);
try {
  // Use snapcraft directly for better control
  execSync('snapcraft --destructive-mode', { cwd: buildDir, stdio: 'inherit' });
} catch (error) {
  console.error('Snap build failed:', error.message);
  // Try electron-builder as fallback
  console.log('Trying electron-builder as fallback...');
  try {
    execSync('electron-builder --linux snap', { cwd: buildDir, stdio: 'inherit' });
  } catch (builderError) {
    console.error('Electron-builder also failed:', builderError.message);
    process.exit(1);
  }
}

console.log(`Build complete! Check ${buildDir} for the snap file`);