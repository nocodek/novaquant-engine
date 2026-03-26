const TelegramBot = require('node-telegram-bot-api');
const dotenv = require('dotenv');

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

let bot = null;

if (token && chatId && token !== 'your_telegram_bot_token_here') {
  bot = new TelegramBot(token, { polling: false });
} else {
  console.warn("Telegram BOT_TOKEN or CHAT_ID not correctly initialized in .env. Alerts will be console logged.");
}

async function sendSignal(pair, timeframe, idm, type, entry) {
  const action = type.includes('BUY') ? 'BUY' : 'SELL';
  const message = `🚨 *[LIVE MTF SIGNAL]*\n\n🔹 *Pair*: ${pair}\n⏱ *Timeframe*: ${timeframe}\n👀 *Action*: ${action}\n🧲 *Inducement Level*: ${idm}\n🎯 *Nearest OB/BB Level*: ${entry}\n\n_Review the ${timeframe} chart for execution._`;
  
  if (bot && chatId) {
    try {
      await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
      console.log(`[Telegram] Alert sent for ${pair} on ${timeframe}`);
    } catch (error) {
      console.error("[Telegram Error] Failed to send message:", error.message);
    }
  } else {
    // Fallback if not configured
    console.log("==> TELEGRAM ALERT:", message.replace(/\*/g, '').replace(/_/g, ''));
  }
}

async function sendBacktestReport(symbol, results) {
  let successCount = 0;
  
  for (const [interval, data] of Object.entries(results)) {
    if (data.error || !data.recent || data.recent.length === 0) continue;
    
    for (const setup of data.recent) {
      const action = setup.type.includes('BUY') ? 'BUY' : 'SELL';
      const message = `🔔 *[MTF Historical]*\n\n🔹 *Pair*: ${symbol}\n⏱ *Timeframe*: ${interval}\n📅 *Date*: ${setup.datetime}\n👀 *Action*: ${action}\n🧲 *Inducement Level*: ${setup.idm}\n🎯 *Nearest OB/BB Level*: ${setup.entry}\n🔰 *Outcome*: ${setup.outcome}\n\n_Review the ${interval} chart for validation._`;
      
      if (bot && chatId) {
        try {
          await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
          successCount++;
          // Space out the payloads to prevent Telegram rate limit issues
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error("[Telegram Error] Failed to send history signal:", error.message);
        }
      } else {
        console.log("==> TELEGRAM HISTORY:", message.replace(/\*/g, '').replace(/_/g, ''));
      }
    }
  }
  
  return true;
}

module.exports = { sendSignal, sendBacktestReport };
