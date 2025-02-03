import fs from 'fs';
import { createLogger, format, transports } from 'winston';

const loggerFilePath = {
  production: 'logs/bot-prod.log',
  development: 'logs/bot-dev.log',
  test: 'logs/bot-test.log',
};

// Only enable debug level if DEBUG is explicitly set to 'true'
const getLogLevel = () => {
  return process.env.DEBUG === 'true' ? 'debug' : 'info';
};

if (fs.existsSync(loggerFilePath[process.env.NODE_ENV])) {
  fs.unlinkSync(loggerFilePath[process.env.NODE_ENV]);
}

export const initLogger = () =>
  createLogger({
    level: getLogLevel(),
    format: format.combine(
      format.timestamp(),
      format.simple()
    ),
    transports: [
      new transports.File({
        filename: loggerFilePath[process.env.NODE_ENV],
        level: getLogLevel()
      })
    ],
  });
