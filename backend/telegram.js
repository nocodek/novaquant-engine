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

async function sendCRT4Signal(pair, action, entry, sl, tp, tpSource, poiType, bosLevel, sweepLevel) {
  const creds = getBot();
  const emoji = action === 'BUY' ? '🟢' : '🔴';
  const message = [
    `🚨 *[CRT4 SIGNAL]*`,
    ``,
    `🔹 *Pair*: ${pair}`,
    `${emoji} *Direction*: ${action}`,
    ``,
    `📊 *Setup Breakdown:*`,
    `  ↳ 4H Sweep Level: \`${sweepLevel}\``,
    `  ↳ 1H BOS Level: \`${bosLevel}\``,
    `  ↳ POI Type: *${poiType}*`,
    ``,
    `🎯 *Entry*: \`${entry}\``,
    `🛡️ *Stop Loss*: \`${sl}\``,
    `🏁 *Take Profit*: \`${tp}\` _(${tpSource})_`,
    ``,
    `_Review the 1H chart. Enter only after confirmed POI retest._`
  ].join('\n');

  if (creds) {
    try {
      await creds.bot.sendMessage(creds.chatId, message, { parse_mode: 'Markdown' });
      logger.success(`CRT4 alert sent for ${pair}`);
    } catch (error) {
      logger.error(`Failed to send CRT4 message: ${error.message}`);
    }
  } else {
    logger.warn(`CRT4 Signal not sent (missing creds): ${message.replace(/\*/g, '').replace(/_/g, '')}`);
  }
}

async function sendCRT4BacktestReport(symbol, crt4Result) {
  const creds = getBot();
  if (!creds) {
    throw new Error('Telegram environment variables (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID) are missing.');
  }

  const setups = (crt4Result.recent || []).slice(0, 3);
  if (setups.length === 0) return true;

  for (const setup of setups) {
    const emoji = setup.type.includes('BUY') ? '🟢' : '🔴';
    const outcomeEmoji = setup.outcome === 'Win' ? '✅' : setup.outcome === 'Loss' ? '❌' : '⏳';
    const message = [
      `🔔 *[CRT4 Historical]*`,
      ``,
      `🔹 *Pair*: ${symbol}`,
      `📅 *Date*: ${setup.datetime}`,
      `${emoji} *Direction*: ${setup.type.includes('BUY') ? 'BUY' : 'SELL'}`,
      ``,
      `📊 *Setup:*`,
      `  ↳ 4H Sweep: \`${setup.sweepLevel}\``,
      `  ↳ 1H BOS: \`${setup.bosLevel}\``,
      `  ↳ POI: *${setup.poiType}*`,
      ``,
      `🎯 *Entry*: \`${setup.entry}\``,
      `🛡️ *SL*: \`${setup.sl}\``,
      `🏁 *TP*: \`${setup.tp}\` _(${setup.tpSource})_`,
      ``,
      `${outcomeEmoji} *Outcome*: ${setup.outcome}`
    ].join('\n');

    try {
      await creds.bot.sendMessage(creds.chatId, message, { parse_mode: 'Markdown' });
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      throw new Error('[Telegram Error] Failed to send CRT4 history: ' + error.message);
    }
  }

  return true;
}

module.exports = { sendCRT4Signal, sendCRT4BacktestReport };
