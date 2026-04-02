const cron = require('node-cron');
const dotenv = require('dotenv');
const { sendCRT4Signal } = require('./telegram');
const { fetchTV } = require('./tv-fetcher');
const { crt4_scan4H, crt4_scan1H, crt4_findTP } = require('./strategy-crt4');
const logger = require('./logger');

dotenv.config();

function isForexClosed() {
    const now = new Date();
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    if (day === 5 && hour >= 22) return true;
    if (day === 6) return true;
    if (day === 0 && hour < 22) return true;
    return false;
}

function startCronJobs(getSettings) {
  const cronOptions = {
    scheduled: true,
    timezone: "Africa/Lagos"
  };

  // Initial run on server start
  setTimeout(async () => {
      logger.info("Running initial server-start CRT4 scan...");
      await scanCRT4_4H(getSettings);
  }, 5000);

  // CRT4: 4H candle closes at 03,07,11,15,19,23 WAT — fire at minute 1
  cron.schedule('1 3,7,11,15,19,23 * * *', async () => {
      logger.info('[CRT4] 4H candle closed. Running 4H sweep scan...');
      await scanCRT4_4H(getSettings);
  }, cronOptions);

  // CRT4: 1H BOS + resolution check runs every hour at minute 2
  cron.schedule('2 * * * *', async () => {
      await scanCRT4_1H(getSettings);
  }, cronOptions);

  logger.info(`CRT4 cron jobs scheduled (timezone: ${cronOptions.timezone})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CRT4 STATEFUL SCANNER
// Each symbol tracks its own phase across cron ticks:
//   SCAN_4H            → default, runs every 4H to detect sweep
//   SCAN_1H_BOS       → sweep found, runs every 1H waiting for BOS + POI retest
//   WAITING_RESOLUTION → signal sent, waiting for TP or SL to be hit
// ─────────────────────────────────────────────────────────────────────────────

const crt4State = {};

function getCRT4State(symbol) {
    if (!crt4State[symbol]) {
        crt4State[symbol] = { phase: 'SCAN_4H', sweep: null, alertedSweepKey: null, trade: null };
    }
    return crt4State[symbol];
}

async function scanCRT4_4H(getSettings) {
    const settings = await getSettings();
    const forexClosed = isForexClosed();
    const allSymbols = [
        ...settings.cryptoPairs,
        ...(forexClosed ? [] : settings.forexPairs)
    ];

    for (const symbol of allSymbols) {
        const state = getCRT4State(symbol);

        if (state.phase !== 'SCAN_4H') {
            logger.info(`[CRT4] ${symbol} is in phase ${state.phase} — skipping 4H scan.`);
            continue;
        }

        try {
            const sweep = await crt4_scan4H(symbol);
            if (sweep) {
                const sweepKey = `${symbol}-CRT4-${sweep.confirmingTs}`;
                if (state.alertedSweepKey === sweepKey) continue;

                logger.info(`[CRT4] 🧲 Sweep on ${symbol} | ${sweep.direction} | ${sweep.confirmingDatetime}`);
                state.phase = 'SCAN_1H_BOS';
                state.sweep = sweep;
                state.alertedSweepKey = sweepKey;
            }
        } catch (err) {
            logger.error(`[CRT4] 4H scan error for ${symbol}: ${err.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

async function scanCRT4_1H(getSettings) {
    const settings = await getSettings();
    const forexClosed = isForexClosed();
    const allSymbols = [
        ...settings.cryptoPairs,
        ...(forexClosed ? [] : settings.forexPairs)
    ];

    const active = allSymbols.filter(s => {
        const ph = getCRT4State(s).phase;
        return ph === 'SCAN_1H_BOS' || ph === 'WAITING_RESOLUTION';
    });
    if (active.length === 0) return;
    logger.info(`[CRT4] 1H scan: ${active.filter(s => getCRT4State(s).phase === 'SCAN_1H_BOS').length} awaiting BOS / ${active.filter(s => getCRT4State(s).phase === 'WAITING_RESOLUTION').length} awaiting resolution`);

    for (const symbol of active) {
        const state = getCRT4State(symbol);

        // ─── WAITING_RESOLUTION: check if current price hit TP or SL ─────────
        if (state.phase === 'WAITING_RESOLUTION' && state.trade) {
            try {
                const data1h = await fetchTV(symbol, '1h', 5);
                if (data1h && data1h.length > 0) {
                    data1h.sort((a, b) => a.timestamp - b.timestamp);
                    const latest = data1h[data1h.length - 1];
                    const { direction, sl, tp } = state.trade;

                    let resolved = false;
                    if (direction === 'BULLISH') {
                        if (parseFloat(latest.low) <= sl)            { logger.warn(`[CRT4] ❌ ${symbol} SL hit.`); resolved = true; }
                        if (tp && parseFloat(latest.high) >= tp)     { logger.success(`[CRT4] ✅ ${symbol} TP hit!`); resolved = true; }
                    } else {
                        if (parseFloat(latest.high) >= sl)           { logger.warn(`[CRT4] ❌ ${symbol} SL hit.`); resolved = true; }
                        if (tp && parseFloat(latest.low) <= tp)      { logger.success(`[CRT4] ✅ ${symbol} TP hit!`); resolved = true; }
                    }

                    if (resolved) {
                        crt4State[symbol] = { phase: 'SCAN_4H', sweep: null, alertedSweepKey: null, trade: null };
                        logger.info(`[CRT4] ${symbol} reset to SCAN_4H.`);
                    }
                }
            } catch (err) {
                logger.error(`[CRT4] Resolution check error for ${symbol}: ${err.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
        }

        // ─── SCAN_1H_BOS: look for entry signal ─────────────────────────────
        if (!state.sweep) continue;

        // Auto-expire: if sweep is older than 5 days with no BOS, reset
        const ageMs = Date.now() - state.sweep.confirmingTs;
        if (ageMs > 5 * 24 * 60 * 60 * 1000) {
            logger.warn(`[CRT4] ${symbol} sweep expired (>5 days). Resetting to SCAN_4H.`);
            crt4State[symbol] = { phase: 'SCAN_4H', sweep: null, alertedSweepKey: null };
            continue;
        }

        try {
            const entry = await crt4_scan1H(symbol, state.sweep);

            if (entry) {
                logger.info(`[CRT4] ✅ Entry found on ${symbol}! Finding TP level...`);

                const tpResult = await crt4_findTP(symbol, entry);
                const tp = tpResult ? tpResult.level : null;
                const tpSource = tpResult ? tpResult.source : 'Manual Review';
                const action = entry.direction === 'BULLISH' ? 'BUY' : 'SELL';

                await sendCRT4Signal(
                    symbol,
                    action,
                    entry.entryPrice.toFixed(5),
                    entry.slPrice.toFixed(5),
                    tp ? tp.toFixed(5) : 'N/A',
                    tpSource,
                    entry.poi.type,
                    entry.bosLevel.toFixed(5),
                    entry.sweepExtreme.toFixed(5)
                );

                crt4State[symbol] = {
                    phase: 'WAITING_RESOLUTION',
                    sweep: null,
                    alertedSweepKey: null,
                    trade: {
                        direction: entry.direction,
                        entry: entry.entryPrice,
                        sl: entry.slPrice,
                        tp: tp
                    }
                };
                logger.success(`[CRT4] Signal sent for ${symbol}. Waiting for resolution (TP/SL).`);
            }
        } catch (err) {
            logger.error(`[CRT4] 1H BOS scan error for ${symbol}: ${err.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

module.exports = { startCronJobs };
