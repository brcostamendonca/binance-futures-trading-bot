import TelegramBot from 'node-telegram-bot-api';
import { log, error as logError } from '../utils/log';
import { telegramBot } from '../init';

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!CHAT_ID) {
  console.error(
    'You must set up the environment variable TELEGRAM_CHAT_ID to use the Telegram bot'
  );
  process.exit(1);
}

export function sendTelegramMessage(message: string) {
  return new Promise<TelegramBot.Message>((resolve, reject) => {
    log(`Attempting to send Telegram message: ${message}`);
    log(`Using chat ID: ${CHAT_ID}`);
    log(`Bot polling enabled: ${telegramBot.isPolling()}`);
    
    telegramBot
      .sendMessage(CHAT_ID, message, { parse_mode: 'HTML' })
      .then((messageInfo) => {
        if (process.env.NODE_ENV === 'test') {
          telegramBot.deleteMessage(
            messageInfo.chat.id,
            String(messageInfo.message_id)
          );
        }

        log(`Telegram message sent successfully`);
        resolve(messageInfo);
      })
      .catch((err) => {
        logError(`Failed to send Telegram message: ${err.message}`);
        logError(`Error details: ${JSON.stringify(err)}`);
        reject(err);
      });
  });
}
