import fs from 'fs';
import { createLogger, format, transports } from 'winston';
import { isMainThread } from 'worker_threads';

const loggerFilePath = {
  production: 'logs/bot-prod.log',
  development: 'logs/bot-dev.log',
  test: 'logs/bot-test.log',
  worker: null // No file logging for worker threads
};

// Only enable debug level if DEBUG is explicitly set to 'true'
const getLogLevel = () => {
  return process.env.DEBUG === 'true' ? 'debug' : 'info';
};

// Create a dummy logger for worker threads
const createWorkerLogger = () => ({
  debug: () => { },
  info: () => { },
  warn: () => { },
  error: (...args) => console.error(...args),
  log: () => { }
});

export const initLogger = () => {
  // Always return dummy logger for worker threads
  if (!isMainThread || process.env.NODE_ENV === 'worker') {
    return createWorkerLogger();
  }

  // Only try to manage log files in main thread
  const logPath = loggerFilePath[process.env.NODE_ENV];
  if (logPath) {
    try {
      // Ensure logs directory exists
      const logsDir = 'logs';
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
      }

      // Delete existing log file if it exists
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
      }
    } catch (error) {
      console.error('Error managing log files:', error);
      return createWorkerLogger(); // Fallback to dummy logger if file operations fail
    }
  }

  // Create real logger for main thread
  return createLogger({
    level: getLogLevel(),
    format: format.combine(
      format.timestamp(),
      format.simple()
    ),
    transports: [
      new transports.File({
        filename: logPath,
        level: getLogLevel()
      })
    ],
  });
};
