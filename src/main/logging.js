// Centralized logging overrides for main process

const setupLogging = () => {
  console.log = (...args) => {
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    process.stdout.write(`[MAIN] ${message}\n`);
  };

  console.error = (...args) => {
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    process.stderr.write(`[MAIN-ERROR] ${message}\n`);
  };
};

module.exports = { setupLogging };
