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

execSync(`cp -r ${path.join(__dirname, 'src')}/* ${buildDir}`);
execSync(`cp -r ${path.join(appDir, 'icons')} ${buildDir}`);
execSync(`cp -r ${path.join(appDir, 'snap')} ${buildDir}`);

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