const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');

function getBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (token && chatId && token !== 'your_telegram_bot_token_here') {
    return { bot: new TelegramBot(token, { polling: false }), chatId };
  }
  return null;
}

async function sendSignal(pair, timeframe, idm, type, entry) {
  const creds = getBot();
  const action = type.includes('BUY') ? 'BUY' : 'SELL';
  const message = `🚨 *[LIVE MTF SIGNAL]*\n\n🔹 *Pair*: ${pair}\n⏱ *Timeframe*: ${timeframe}\n👀 *Action*: ${action}\n🧲 *Inducement Level*: ${idm}\n🎯 *Nearest OB/BB Level*: ${entry}\n\n_Review the ${timeframe} chart for execution._`;
  
  if (creds) {
    try {
      await creds.bot.sendMessage(creds.chatId, message, { parse_mode: "Markdown" });
      logger.success(`Alert sent for ${pair} on ${timeframe}`);
    } catch (error) {
      logger.error(`Failed to send message: ${error.message}`);
    }
  } else {
    logger.warn(`Signal not sent because TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing from environment secrets: ${message.replace(/\*/g, '').replace(/_/g, '')}`);
  }
}

async function send180Signal(pair, action, entry, sl, context, timeframe = '5m') {
  const creds = getBot();
  const message = `🚨 *[LIVE 180 STRATEGY]*\n\n🔹 *Pair*: ${pair}\n⏱ *Timeframe*: ${timeframe}\n👀 *Action*: ${action}\n📍 *Context*: ${context}\n🎯 *Entry Trigger*: ${entry}\n🛡️ *Stop Loss*: ${sl}\n\n_Review the ${timeframe} chart for execution and manage with 8MA trailing stop._`;
  
  if (creds) {
    try {
      await creds.bot.sendMessage(creds.chatId, message, { parse_mode: "Markdown" });
      logger.success(`180 Strategy alert sent for ${pair}`);
    } catch (error) {
      logger.error(`Failed to send message: ${error.message}`);
    }
  } else {
    logger.warn(`180 Signal not sent (missing creds): ${message.replace(/\*/g, '').replace(/_/g, '')}`);
  }
}

async function sendBacktestReport(symbol, results) {
  const creds = getBot();
  if (!creds) {
      throw new Error("Telegram environment variables (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID) are missing from the server secrets.");
  }

  let successCount = 0;
  
  for (const [interval, data] of Object.entries(results)) {
    if (data.error || !data.recent || data.recent.length === 0) continue;
    
    for (const setup of data.recent) {
      const action = setup.type.includes('BUY') ? 'BUY' : 'SELL';
      const message = `🔔 *[MTF Historical]*\n\n🔹 *Pair*: ${symbol}\n⏱ *Timeframe*: ${interval}\n📅 *Date*: ${setup.datetime}\n👀 *Action*: ${action}\n🧲 *Inducement Level*: ${setup.idm}\n🎯 *Nearest OB/BB Level*: ${setup.entry}\n🔰 *Outcome*: ${setup.outcome}\n\n_Review the ${interval} chart for validation._`;
      
      try {
        await creds.bot.sendMessage(creds.chatId, message, { parse_mode: "Markdown" });
        successCount++;
        // Space out the payloads to prevent Telegram rate limit issues
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        throw new Error("[Telegram Error] Failed to send history signal: " + error.message);
      }
    }
  }
  
  return true;
}

module.exports = { sendSignal, sendBacktestReport, send180Signal };
