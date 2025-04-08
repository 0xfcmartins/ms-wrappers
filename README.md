# Web Wrappers
**Unofficial Electron wrappers for web applications, built for Linux desktop.**
## Description
This project provides Electron-based desktop applications that wrap web services, making them feel more like native applications. Currently, it includes wrappers for:
- Microsoft Teams
- Outlook

Each wrapper has its own configuration and can be built and run independently.
## Features
- Clean desktop integration with application icons
- Window state persistence (position and size)
- Snap package generation for easy installation on Linux systems
- Development mode for quick testing

## Requirements
- Node.js and npm
- Electron
- Snapcraft (for building snap packages)

## Installation
Clone the repository and install dependencies:
``` bash
    git clone https://github.com/0xfcmartins/teams-ew.git
    cd teams-ew
    npm install
```
## Available Scripts
### Development Mode
Run applications in development mode for testing:
``` bash
    # Run Teams
    npm run dev:teams
    
    # Run Outlook
    npm run dev:outlook
```
### Building Applications
Build the applications for distribution:
``` bash
    # Build Teams
    npm run build:teams
    
    # Build Outlook
    npm run build:outlook
```
The build process will create:
- Debian package (.deb)
- AppImage
- Snap package

### Running Built Applications
Run the applications directly using Electron:
``` bash
    # Run Teams
    npm run run:teams
    
    # Run Outlook
    npm run run:outlook
```
## Project Structure
``` 
    .
    ├── apps/                   # App-specific configurations
    │   ├── teams/             # Teams app files
    │   │   ├── config.json    # App-specific config
    │   │   ├── package.json   # App-specific package info
    │   │   └── icons/         # App icons
    │   └── outlook/           # Outlook app files
    ├── src/                    # Source code for the Electron app
    │   ├── main/              # Main process code
    │   ├── preload/           # Preload scripts
    │   └── main.js            # Entry point
    ├── build.js               # Build script
    ├── dev-run.js             # Development runner script
    └── snapcraft.yaml.template # Template for Snap packaging
```
## Building Snap Packages
The project automatically generates snap packages during the build process. It uses the template specified in `snapcraft.yaml.template` and creates a customized version for each application based on its configuration.
## License
MIT
## Author
Francisco Martins <francisco_jcm_7@hotmail.com>
## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.
For more information, visit the [GitHub repository](https://github.com/0xfcmartins/teams-ew).
