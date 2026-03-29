const cron = require('node-cron');
const dotenv = require('dotenv');
const { sendSignal, send180Signal } = require('./telegram');
const { fetchTV } = require('./tv-fetcher');
const { runLiveScannerData } = require('./backtest-api');
const { run180Scanner } = require('./strategy-180');
const logger = require('./logger');

dotenv.config();

const lastProcessed = {};

function isForexClosed() {
    const now = new Date();
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    // Forex is closed Friday 22:00 UTC to Sunday 22:00 UTC
    if (day === 5 && hour >= 22) return true; // Friday after 22:00 UTC
    if (day === 6) return true; // Saturday
    if (day === 0 && hour < 22) return true; // Sunday before 22:00 UTC
    return false;
}

async function scanSymbols(getSettings, interval, timeframeLabel) {
  logger.info(`Polling logic triggered for ${timeframeLabel}...`);
  const settings = await getSettings();
  
  const forexClosed = isForexClosed();
  if (forexClosed) {
      logger.info(`Forex market is closed. Skipping Forex pairs.`);
  }

  const allSymbols = [
      ...settings.cryptoPairs, 
      ...(forexClosed ? [] : settings.forexPairs)
  ];

  for (const symbol of allSymbols) {
    try {
      // Execute MTF natively for the requested interval (1h or 30m)
      const setups = await runLiveScannerData(symbol, interval);
      if (setups && setups.length > 0) {
          const latestSetup = setups[setups.length - 1];
          const setupKey = `${symbol}-${timeframeLabel}-${latestSetup.datetime}`;
          
          const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Lagos' }).substring(0, 10);
          
          if (!lastProcessed[setupKey] && latestSetup.datetime.startsWith(todayStr)) {
              lastProcessed[setupKey] = true;
              sendSignal(symbol, timeframeLabel, latestSetup.idm, latestSetup.type, latestSetup.entry);
          }
      }
    } catch(err) {
      logger.error(`Failed TV fetch for ${symbol}: ${err.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

async function scan180Symbols(getSettings) {
  logger.info(`Polling 180 Strategy for 5m...`);
  const settings = await getSettings();
  
  const forexClosed = isForexClosed();
  
  const allSymbols = [
      ...settings.cryptoPairs, 
      ...(forexClosed ? [] : settings.forexPairs)
  ];

  for (const symbol of allSymbols) {
    try {
      const setups = await run180Scanner(symbol);
      if (setups && setups.length > 0) {
          const latestSetup = setups[setups.length - 1];
          // Use a specific key for 180 strategy to avoid collision
          const setupKey = `${symbol}-180-5m-${latestSetup.datetime}`;
          
          const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Lagos' }).substring(0, 10);
          
          if (!lastProcessed[setupKey] && latestSetup.datetime.startsWith(todayStr)) {
              lastProcessed[setupKey] = true;
              let action = latestSetup.type.includes('BUY') ? 'BUY' : 'SELL';
              send180Signal(symbol, action, latestSetup.entry, latestSetup.sl, latestSetup.context);
          }
      }
    } catch(err) {
      logger.error(`Failed 180 TV fetch for ${symbol}: ${err.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

function startCronJobs(getSettings) {
  const cronOptions = {
    scheduled: true,
    timezone: "Africa/Lagos" 
  };

  // Initial Run on Start
  setTimeout(async () => {
      logger.info("Running initial server-start scan...");
      await scanSymbols(getSettings, '1h', '1 Hour');
      await scanSymbols(getSettings, '30m', '30 Minute');
      await scan180Symbols(getSettings);
  }, 5000);

  // Hourly Polling for both 1H and 30m (runs at minute 1 sequentially)
  cron.schedule('1 * * * *', async () => {
      await scanSymbols(getSettings, '1h', '1 Hour');
      await scanSymbols(getSettings, '30m', '30 Minute');
  }, cronOptions);

  // 30m Mid-Hour Polling (runs at minute 31)
  cron.schedule('31 * * * *', async () => {
      await scanSymbols(getSettings, '30m', '30 Minute');
  }, cronOptions);

  // 180 Strategy Polling (runs every 5 minutes)
  cron.schedule('*/5 * * * *', async () => {
      await scan180Symbols(getSettings);
  }, cronOptions);

  logger.info(`Dual 1H/30m Strategy & 180 Strategy Cron jobs scheduled using timezone ${cronOptions.timezone}`);
}

module.exports = { startCronJobs };
