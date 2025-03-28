# Teams for Linux
## Overview
Teams Wrapper is an Electron-based application that provides a desktop wrapper for Microsoft Teams with notification badge support. It allows you to use Microsoft Teams as a standalone desktop application on Linux systems.
## Features
- Microsoft Teams as a standalone desktop application
- System tray integration with notification badge
- Custom window management
- Native desktop notifications

## Installation
### Prerequisites
- Node.js and npm installed

### Install Dependencies
``` bash
    npm install
```
## Usage
### Development
To run the application in development mode:
``` bash
    npm start
```
### Building
To build a Debian package:
``` bash
    npm run build
```
To build all supported Linux formats (Debian and AppImage):
``` bash
    npm run build:all
```
## Project Structure
- `main.js`: Main application entry point
- `index.js`: Tray window configuration and management
- `package.json`: Project configuration and dependencies

## Technologies
- Electron 35.1.2
- electron-tray-window 1.2.7
- electron-builder 24.6.4

## License
This project is licensed under the MIT License.
## Author
Francisco Martins <fcmartins@portoeditora.pt>
