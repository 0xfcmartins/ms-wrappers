// Centralized logging overrides for main process

const setupLogging = () => {
  const originalConsole = console.log;
  console.log = (...args) => {
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    process.stdout.write(`[MAIN] ${message}\n`);
    originalConsole.apply(console, args);
  };

  const originalConsoleError = console.error;
  console.error = (...args) => {
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    process.stderr.write(`[MAIN-ERROR] ${message}\n`);
    originalConsoleError.apply(console, args);
  };
};

module.exports = { setupLogging };
