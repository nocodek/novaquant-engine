/**
 * CRT4 Strategy — Candle Range Theory (Daily + 4H)
 * ===========================================
 * Phase 1 (SCAN_DAILY):    Detect sweep of last Daily candle range + body confirmation
 * Phase 2 (SCAN_4H_BOS):   Wait for 4H break of structure (BOS) after daily sweep
 * Phase 3 (SCAN_4H_POI):   After BOS, wait for price to retrace into 4H OB/BB/FVG
 * Phase 4 (WEEKLY_TP):     Find nearest unswept Weekly swing H/L for TP target
 */

const { fetchTV } = require('./tv-fetcher');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function p(v) { return parseFloat(v); }

/**
 * Returns the pip/point size for a given symbol.
 * 100 pips of range = minimum allowed 4H candle range.
 */
function getPipSize(symbol) {
    const s = (symbol || '').toUpperCase();
    if (/JPY/.test(s)) return 0.01;               // JPY pairs: 1 pip = 0.01
    if (/XAU|GOLD/.test(s)) return 0.1;           // Gold: 1 pip = $0.10 → 100 pips = $10
    if (/XAG/.test(s)) return 0.001;              // Silver
    if (/BTC|XBT/.test(s)) return 1.0;            // Bitcoin: 1 pip = $1
    if (/ETH|SOL|ADA|XRP|DOGE/.test(s)) return 0.001; // Other crypto
    return 0.0001;                                 // Standard forex pairs
}

/**
 * Detect a 4H swing high/low using a N-bar lookback on both sides (confirmed).
 * Uses 3 bars each side so it's confirmed but not too lagging.
 */
function is4HSwingLow(data, i, lookback = 3) {
    if (i < lookback || i + lookback >= data.length) return false;
    const refLow = p(data[i].low);
    for (let j = 1; j <= lookback; j++) {
        if (p(data[i - j].low) <= refLow) return false;
        if (p(data[i + j].low) <= refLow) return false;
    }
    return true;
}

function is4HSwingHigh(data, i, lookback = 3) {
    if (i < lookback || i + lookback >= data.length) return false;
    const refHigh = p(data[i].high);
    for (let j = 1; j <= lookback; j++) {
        if (p(data[i - j].high) >= refHigh) return false;
        if (p(data[i + j].high) >= refHigh) return false;
    }
    return true;
}

/**
 * Walk FORWARD from afterIdx to find the first confirmed 1H swing HIGH.
 * Confirmed = 2 bars on each side must have a strictly lower high.
 * Returns { price, index } or null.
 */
function findFirstSwingHighAfter(data1h, afterIdx) {
    for (let i = afterIdx + 2; i < data1h.length - 2; i++) {
        const h = p(data1h[i].high);
        if (
            p(data1h[i-2].high) < h && p(data1h[i-1].high) < h &&
            p(data1h[i+1].high) < h && p(data1h[i+2].high) < h
        ) {
            return { price: h, index: i, datetime: data1h[i].datetime };
        }
    }
    return null;
}

/**
 * Walk FORWARD from afterIdx to find the first confirmed 1H swing LOW.
 * Confirmed = 2 bars on each side must have a strictly higher low.
 */
function findFirstSwingLowAfter(data1h, afterIdx) {
    for (let i = afterIdx + 2; i < data1h.length - 2; i++) {
        const l = p(data1h[i].low);
        if (
            p(data1h[i-2].low) > l && p(data1h[i-1].low) > l &&
            p(data1h[i+1].low) > l && p(data1h[i+2].low) > l
        ) {
            return { price: l, index: i, datetime: data1h[i].datetime };
        }
    }
    return null;
}

/**
 * Walk FORWARD from startIdx to find the first 1H candle whose
 * BODY (close) breaks past bosLevel.
 * A single wick past the level does NOT count — the close must be beyond.
 */
function findFirstBOSCandle(data1h, startIdx, direction, bosLevel) {
    for (let i = startIdx; i < data1h.length; i++) {
        const close = p(data1h[i].close);
        if (direction === 'BULLISH' && close > bosLevel) return { candle: data1h[i], index: i };
        if (direction === 'BEARISH' && close < bosLevel) return { candle: data1h[i], index: i };
    }
    return null;
}

/**
 * Find the 1H POI (OB / FVG) to enter on after BOS.
 * Scans backwards from the BOS candle toward the sweep.
 *
 * QUALITY FILTER: Breaker Blocks (BB) are EXCLUDED.
 * A BB is a zone that was already tested and failed — price has already
 * used that level once, making it significantly less reliable than a fresh OB or FVG.
 * Backtest data showed 0% win rate on BB entries vs 33%+ on OB/FVG.
 *
 * For BULLISH (expecting price to retrace DOWN into OB/FVG before going up):
 *   - OB: last BEARISH (red) 1H candle before the impulse that broke structure
 *   - FVG: 3-candle gap where candle[n+2].low > candle[n].high (bullish FVG above)
 *
 * For BEARISH:
 *   - OB: last BULLISH (green) 1H candle before the impulse
 *   - FVG: candle[n+2].high < candle[n].low (bearish FVG below)
 */
function find1HPOI(data1h, bosIndex, direction, sweepTimestamp) {
    // Walk backwards from bosIndex toward the sweep
    for (let j = bosIndex - 1; j >= 1; j--) {
        if (data1h[j].timestamp < sweepTimestamp) break;

        const c    = data1h[j];
        const cNext = j + 1 < data1h.length ? data1h[j + 1] : null;

        // ── FVG check (3-candle imbalance) ──────────────────────────────
        if (cNext && j >= 1) {
            const cBefore = data1h[j - 1];
            if (direction === 'BULLISH' && p(cBefore.high) < p(cNext.low)) {
                return {
                    type: 'FVG',
                    high: p(cNext.low),
                    low:  p(cBefore.high),
                    midpoint: (p(cNext.low) + p(cBefore.high)) / 2
                };
            }
            if (direction === 'BEARISH' && p(cBefore.low) > p(cNext.high)) {
                return {
                    type: 'FVG',
                    high: p(cBefore.low),
                    low:  p(cNext.high),
                    midpoint: (p(cBefore.low) + p(cNext.high)) / 2
                };
            }
        }

        // ── OB check (Breaker Blocks excluded — 0% WR in backtests) ─────
        // An opposing candle is an OB if price passed straight through it.
        // If that candle's extreme was violated before BOS (BB) — skip it.
        const isBearCandle = p(c.close) < p(c.open);
        const isBullCandle = p(c.close) > p(c.open);

        if (direction === 'BULLISH' && isBearCandle) {
            let wasBroken = false;
            for (let k = j + 1; k <= bosIndex; k++) {
                if (p(data1h[k].low) < p(c.low)) { wasBroken = true; break; }
            }
            if (wasBroken) continue; // BB — skip, keep looking for a fresh OB or FVG
            return {
                type: 'OB',
                high: p(c.high), low: p(c.low),
                midpoint: (p(c.high) + p(c.low)) / 2
            };
        }

        if (direction === 'BEARISH' && isBullCandle) {
            let wasBroken = false;
            for (let k = j + 1; k <= bosIndex; k++) {
                if (p(data1h[k].high) > p(c.high)) { wasBroken = true; break; }
            }
            if (wasBroken) continue; // BB — skip
            return {
                type: 'OB',
                high: p(c.high), low: p(c.low),
                midpoint: (p(c.high) + p(c.low)) / 2
            };
        }
    }
    return null;
}

/**
 * Compute a simple N-period EMA on an array of close values.
 */
function calcEMA(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
}

/**
 * Determine market bias on the DAILY timeframe using dual EMA (50 + 200).
 *
 * Rules:
 *  - BULLISH  : close > EMA-50 AND close > EMA-200 (clean uptrend).
 *  - BEARISH  : close < EMA-50 AND close < EMA-200 (clean downtrend).
 *  - null     : EMA crossover zone (EMAs are within 0.5% of each other → choppy → skip).
 *
 * Needs 205+ Daily candles (roughly 9-10 months of history).
 */
function getDailyTrend(dataD) {
    if (!dataD || dataD.length < 205) return null;
    const closes = dataD.map(c => p(c.close));
    const ema50  = calcEMA(closes, 50);
    const ema200 = calcEMA(closes, 200);
    if (ema50 === null || ema200 === null) return null;

    const lastClose = closes[closes.length - 1];

    // Neutral zone: EMAs within 1% of each other = ranging market.
    // Use stricter 1% (up from 0.5%) — when EMAs are this close, the market
    // is consolidating and both bull/bear setups fail at high rates.
    const emaDiffPct = Math.abs(ema50 - ema200) / ema200;
    if (emaDiffPct < 0.01) return null; // within 1% → indeterminate, skip ALL setups

    if (lastClose > ema50 && lastClose > ema200) return 'BULLISH';
    if (lastClose < ema50 && lastClose < ema200) return 'BEARISH';

    return null; // price between EMAs — transitional, skip
}

/**
 * Trend over-extension guard.
 *
 * After a sustained directional run exceeding `maxPct` of price from its
 * recent swing origin, continuation setups are blocked — they have poor R:R
 * and high reversal risk.
 *
 * Algorithm:
 *  BEARISH (SELL):  Find the highest HIGH within the last `lookback` 4H candles
 *                   (swing top of the current down-leg). If current close is
 *                   more than `maxPct` % below that top, the bear leg is over-extended.
 *
 *  BULLISH (BUY):   Find the lowest LOW within the last `lookback` 4H candles
 *                   (swing bottom of the current up-leg). If current close is
 *                   more than `maxPct` % above that bottom, the bull leg is over-extended.
 *
 * Default: lookback = 20 candles (3.3 days), maxPct = 8%.
 *   On XAUUSD @ 5000: 8% = $400 = 4000 pips. The Mar 25 rogue SELL had
 *   already dropped ~17% from 5192 to 4402, so it correctly triggers.
 *   The first Mar 9 BUY started fresh; its 20-bar swing bottom was ~5015
 *   and entry was at 5192 → only 3.4% up — passes through.
 *
 * @param {Array}  data4h    - Sorted 4H candles up to the current bar.
 * @param {string} direction - 'BULLISH' or 'BEARISH'.
 * @param {number} lookback  - Bars to look back for the swing origin.
 * @param {number} maxPct    - Max % extension before the leg is considered exhausted.
 * @returns {boolean} true = over-extended, do NOT trade.
 */
function isTrendOverExtended(data4h, direction, lookback = 20, maxPct = 0.08) {
    if (!data4h || data4h.length < lookback + 1) return false;
    const slice     = data4h.slice(-lookback);
    const lastClose = p(data4h[data4h.length - 1].close);

    if (direction === 'BEARISH') {
        const legTop = Math.max(...slice.map(c => p(c.high)));
        const dropPct = (legTop - lastClose) / legTop;
        return dropPct > maxPct;
    } else {
        const legBottom = Math.min(...slice.map(c => p(c.low)));
        const risePct   = (lastClose - legBottom) / legBottom;
        return risePct > maxPct;
    }
}

/**
 * TP = nearest intact 4H liquidity pool / swing macro structure.
 *
 * Logic:
 *   BUY  → next unswept 4H Swing HIGH above entry (sell-side liquidity rests there)
 *   SELL → next unswept 4H Swing LOW  below entry (buy-side liquidity rests there)
 *
 * "Unswept" = no subsequent 4H candle within the dataset has yet traded through the level.
 * Minimum distance = 100 pips from entry to skip structures inside the BOS zone.
 */
function find4HLiquidityTP(data4h, direction, entryPrice, symbol, sourceLabel = '4H Swing') {
    const minDist = 100 * getPipSize(symbol || 'DEFAULT');
    const candidates = [];

    for (let i = 3; i < data4h.length - 3; i++) {
        if (direction === 'BULLISH' && is4HSwingHigh(data4h, i, 3)) {
            const h = p(data4h[i].high);
            if (h < entryPrice + minDist) continue;
            // Only intact (unswept) swing highs — no later candle has exceeded this level
            const swept = data4h.slice(i + 1).some(fc => p(fc.high) > h);
            if (!swept) candidates.push({ price: h, source: `${sourceLabel} High` });
        }

        if (direction === 'BEARISH' && is4HSwingLow(data4h, i, 3)) {
            const l = p(data4h[i].low);
            if (l > entryPrice - minDist) continue;
            const swept = data4h.slice(i + 1).some(fc => p(fc.low) < l);
            if (!swept) candidates.push({ price: l, source: `${sourceLabel} Low` });
        }
    }

    if (direction === 'BULLISH') {
        const above = candidates.filter(c => c.price > entryPrice + minDist);
        if (above.length === 0) return null;
        // Nearest unswept swing high above entry
        const nearest = above.reduce((a, b) => a.price < b.price ? a : b);
        return { level: nearest.price, source: nearest.source };
    } else {
        const below = candidates.filter(c => c.price < entryPrice - minDist);
        if (below.length === 0) return null;
        // Nearest unswept swing low below entry
        const nearest = below.reduce((a, b) => a.price > b.price ? a : b);
        return { level: nearest.price, source: nearest.source };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: 4H SWEEP DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run on the latest 4H data.
 * Returns sweep info if the most recent completed candle swept the prior candle's range
 * AND the confirming body close condition is met.
 *
 * We look at the last 4 candles to catch the setup as soon as it forms on close.
 */
function detect4HSweep(data4h, minRange = 0) {
    if (data4h.length < 4) return null;

    // Last fully closed candles: [n-2] is the "range" candle, [n-1] is the current close
    // (the live candle [n] is excluded since it hasn't closed yet)
    const n = data4h.length - 1; // most recent closed candle

    for (let offset = 0; offset <= 2; offset++) {
        const confirming = data4h[n - offset];       // candle that "confirms"
        const range = data4h[n - offset - 1];        // the candle whose range is swept

        if (!confirming || !range) continue;

        const rangeHigh  = p(range.high);
        const rangeLow   = p(range.low);
        const rangeClose = p(range.close);

        const confHigh    = p(confirming.high);
        const confLow     = p(confirming.low);
        const confClose   = p(confirming.close);
        const confOpen    = p(confirming.open);

        // ── Range size filter (must be >= 100 pips) ──────────────────────
        const rangeSize = rangeHigh - rangeLow;
        if (minRange > 0 && rangeSize < minRange) continue;

        // ── Bullish: sweep of the LOW, body closes back at/above prev close ──
        if (confLow < rangeLow && confClose >= rangeClose) {
            return {
                direction: 'BULLISH',
                sweepExtreme: confLow,
                prevCandleHigh: rangeHigh,
                prevCandleLow: rangeLow,
                prevCandleClose: rangeClose,
                confirmingTs: confirming.timestamp,
                confirmingDatetime: confirming.datetime
            };
        }

        // ── Bearish: sweep of the HIGH, body closes back at/below prev close ──
        if (confHigh > rangeHigh && confClose <= rangeClose) {
            return {
                direction: 'BEARISH',
                sweepExtreme: confHigh,
                prevCandleHigh: rangeHigh,
                prevCandleLow: rangeLow,
                prevCandleClose: rangeClose,
                confirmingTs: confirming.timestamp,
                confirmingDatetime: confirming.datetime
            };
        }
    }

    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2+3: 1H BOS → POI RETEST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given 1H data and the sweep context, detect:
 *
 * 1. The FIRST confirmed 1H swing HH (bull) or LL (bear) formed AFTER the sweep.
 *    This is the structural level price must break — the "previous HH" or "previous LL".
 *    A confirmed swing requires 2 bars on each side (stricter than a simple pivot).
 *
 * 2. The FIRST 1H candle whose BODY (close) breaks past that structural level.
 *    A wick through the level does NOT count. This is the BOS candle.
 *
 * 3. A POI (OB / FVG) formed in the impulse leg between the sweep and the BOS.
 *    Price should retrace back into this zone for entry.
 *
 * Returns null if any step is not yet satisfied.
 */
function detect1HEntry(data1h, sweepState) {
    const { direction, sweepTimestamp, sweepExtreme } = sweepState;

    // Index of the first 1H candle that closed AFTER the 4H sweep
    const afterSweepIdx = data1h.findIndex(c => c.timestamp > sweepTimestamp);
    if (afterSweepIdx < 0 || data1h.length - afterSweepIdx < 6) return null;

    // ── Step A: Find the FIRST confirmed 1H swing after the sweep ──────────
    // This is the HH (bullish) or LL (bearish) that defines the structure to break.
    let swing = null;
    if (direction === 'BULLISH') {
        swing = findFirstSwingHighAfter(data1h, afterSweepIdx);
    } else {
        swing = findFirstSwingLowAfter(data1h, afterSweepIdx);
    }
    if (!swing) return null; // structure not yet formed

    const bosLevel    = swing.price;
    const bosSwingIdx = swing.index;

    // ── Step B: Find the FIRST 1H body-close that breaks that structure ────
    // Walk forward from the candle AFTER the swing.
    const bosHit = findFirstBOSCandle(data1h, bosSwingIdx + 1, direction, bosLevel);
    if (!bosHit) return null; // BOS has not happened yet

    const bosCandle = bosHit.candle;
    const bosIndex  = bosHit.index;

    // ── Step C: Find a valid POI in the impulse leg ────────────────────────
    // Walk backwards from the BOS candle toward the sweep, looking for an OB or FVG.
    const poi = find1HPOI(data1h, bosIndex, direction, sweepTimestamp);
    if (!poi) return null;

    // ── Step D: Compute entry price and stop loss ──────────────────────────
    let entryPrice, slPrice;
    // SL buffer = 10 pips below/above the sweep extreme
    const slBuffer  = 10 * getPipSize(sweepState.symbol || 'DEFAULT');
    // Minimum SL distance: 30 pips for JPY pairs, 20 pips for others
    // Prevents noise-level stops that get hit by random 1H wick fluctuations
    const pip       = getPipSize(sweepState.symbol || 'DEFAULT');
    const minSLPips = /JPY/i.test(sweepState.symbol || '') ? 30 : 20;
    const minSLDist = minSLPips * pip;

    if (direction === 'BULLISH') {
        // For OB/BB: enter at the top of the zone. For FVG: enter at the midpoint.
        entryPrice = poi.type === 'FVG' ? poi.midpoint : poi.high;
        // SL = 10 pips below the sweep extreme (the liquidity grab low)
        slPrice = sweepExtreme - slBuffer;
    } else {
        entryPrice = poi.type === 'FVG' ? poi.midpoint : poi.low;
        // SL = 10 pips above the sweep extreme (the liquidity grab high)
        slPrice = sweepExtreme + slBuffer;
    }

    // Enforce minimum SL distance — skip if stop is too tight (noise)
    const slDist = Math.abs(entryPrice - slPrice);
    if (slDist < minSLDist) return null;

    // ── Step E: POI Retest check ───────────────────────────────────────────
    // Only fire the signal when price has PULLED BACK INTO the POI zone.
    // A wick through the entry level counts; we don't need a full-body close here.
    // This prevents chasing the BOS move and ensures we're entering on retracement.
    const latest = data1h[data1h.length - 1];
    if (direction === 'BULLISH') {
        // For bull: entry is at/near poi.high — price must pull back down to it
        if (p(latest.low) > entryPrice) return null;
    } else {
        // For bear: entry is at/near poi.low — price must pull back up to it
        if (p(latest.high) < entryPrice) return null;
    }

    return {
        direction,
        bosLevel,
        bosDatetime: bosCandle.datetime,
        poi,
        entryPrice,
        slPrice,
        sweepExtreme
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE SCANNER PHASES (called from scanner.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the symbol is XAUUSD (or GOLD).
 * XAUUSD keeps the original 4H sweep + 1H entry + 4H TP setup
 * because the 4H timeframe is well-calibrated for gold (83%+ backtest WR).
 * All other pairs (Forex + Crypto) use Daily sweep + 4H entry + Weekly TP.
 */
function isXAUUSD(symbol) {
    return /XAU|GOLD/i.test(symbol);
}

/**
 * Returns true only for Crypto pairs (route to Daily+4H+Weekly).
 * Forex pairs (including XAUUSD/XAGUSD) all use 4H+1H+4H.
 */
function isCrypto(symbol) {
    return /BTC|ETH|SOL|XRP|ADA|DOGE|BNB|MATIC|AVAX/i.test(symbol);
}

/**
 * Phase 1: Detect CRT sweep.
 * ─ Crypto           : scans Daily candles (larger structural sweeps).
 * ─ Forex + Gold     : scans 4H candles (original calibrated setup).
 * Returns sweep state object or null.
 */
async function crt4_scanDaily(symbol) {
    const crypto = isCrypto(symbol);

    if (crypto) {
        // ── Crypto: Daily sweep + EMA-50/200 on Daily ─────────────────
        const dataD = await fetchTV(symbol, '1D', 300);
        if (!dataD || dataD.length < 55) return null;
        dataD.sort((a, b) => a.timestamp - b.timestamp);

        const trend = getDailyTrend(dataD);
        const minRange = 100 * getPipSize(symbol);
        const sweep = detect4HSweep(dataD, minRange);
        if (!sweep) return null;
        if (trend && sweep.direction !== trend) {
            console.log(`[CRT4] ${symbol} daily sweep ${sweep.direction} filtered — Daily trend is ${trend}`);
            return null;
        }
        if (isTrendOverExtended(dataD, sweep.direction, 10, 0.08)) {
            console.log(`[CRT4] ${symbol} ${sweep.direction} daily leg over-extended — filtered.`);
            return null;
        }
        return sweep;
    }

    // ── Forex + Gold: 4H sweep + EMA-50/200 on 4H ─────────────────────
    const data4h = await fetchTV(symbol, '4h', 300);
    if (!data4h || data4h.length < 55) return null;
    data4h.sort((a, b) => a.timestamp - b.timestamp);

    const trend = getDailyTrend(data4h);
    // Forex 4H candles average 30-80 pips; 50 pips is a meaningful institutional move
    // XAUUSD is already in this branch and keeps 100 pips
    const minRange = (isXAUUSD(symbol) ? 100 : 50) * getPipSize(symbol);
    const sweep = detect4HSweep(data4h, minRange);
    if (!sweep) return null;
    if (trend && sweep.direction !== trend) {
        console.log(`[CRT4] ${symbol} 4H sweep ${sweep.direction} filtered — 4H trend is ${trend}`);
        return null;
    }
    if (isTrendOverExtended(data4h, sweep.direction, 20, 0.08)) {
        console.log(`[CRT4] ${symbol} ${sweep.direction} 4H leg over-extended — filtered.`);
        return null;
    }
    return sweep;
}

/**
 * Phase 2+3: BOS + POI entry scan.
 * ─ All pairs : scans 1H candles (4H sweep → 1H BOS entry).
 *   (Crypto also uses 1H for now since its sweep is Daily and entry on 4H
 *    would still feed into the same detect1HEntry logic)
 * Returns full entry object or null.
 */
async function crt4_scan4H(symbol, sweepState) {
    // All pairs use 1H for entry — consistent with the original 4H sweep model.
    // Crypto uses 4H but detect1HEntry works on any candle resolution.
    const tf = isCrypto(symbol) ? '4h' : '1h';
    const limit = isCrypto(symbol) ? 500 : 200;
    const data = await fetchTV(symbol, tf, limit);
    if (!data || data.length < 10) return null;
    data.sort((a, b) => a.timestamp - b.timestamp);
    const normalised = { ...sweepState, sweepTimestamp: sweepState.sweepTimestamp || sweepState.confirmingTs, symbol };
    return detect1HEntry(data, normalised);
}

/**
 * Find TP level.
 * ─ Crypto           : nearest unswept Weekly swing (matches Daily sweep scale).
 * ─ Forex + Gold     : nearest unswept 4H swing (matches 4H sweep scale).
 * Returns { level, source } or null.
 */
async function crt4_findTP(symbol, entryResult) {
    if (isCrypto(symbol)) {
        const dataW = await fetchTV(symbol, '1W', 150);
        if (!dataW || dataW.length < 10) return null;
        dataW.sort((a, b) => a.timestamp - b.timestamp);
        return find4HLiquidityTP(dataW, entryResult.direction, entryResult.entryPrice, symbol, 'Weekly Swing');
    }
    // Forex + Gold: 4H TP target
    const data4h = await fetchTV(symbol, '4h', 300);
    if (!data4h || data4h.length < 10) return null;
    data4h.sort((a, b) => a.timestamp - b.timestamp);
    return find4HLiquidityTP(data4h, entryResult.direction, entryResult.entryPrice, symbol, '4H Swing');
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKTESTING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

async function runCRT4Backtest(symbol, startDate, endDate) {
    try {
        console.log(`[CRT4] Fetching data for backtest: ${symbol}...`);
        const isGold   = isXAUUSD(symbol);
        const crypto   = isCrypto(symbol);

        // Timeframe routing:
        //   Crypto       :  sweepTF='1D'  entryTF='4h'  tpTF='1W'
        //   Forex + Gold :  sweepTF='4h'  entryTF='1h'  tpTF='4h'
        const sweepTF  = crypto ? '1D'  : '4h';
        const entryTF  = crypto ? '4h'  : '1h';
        const tpTF     = crypto ? '1W'  : '4h';
        const sweepLim = crypto ? 500   : 1000;
        const entryLim = 2000;
        const tpLim    = crypto ? 150   : 300;

        const [rawSwp, rawEntry, rawTP] = await Promise.all([
            fetchTV(symbol, sweepTF,  sweepLim, endDate),
            fetchTV(symbol, entryTF,  entryLim, endDate),
            fetchTV(symbol, tpTF,     tpLim,    endDate)
        ]);

        const startMs = new Date(startDate + 'T00:00:00Z').getTime();
        const endMs   = new Date(endDate   + 'T23:59:59Z').getTime();

        if (rawSwp.length < 10 || rawEntry.length < 20) {
            return { error: 'Insufficient data for CRT4 backtest.' };
        }

        rawSwp.sort((a, b)   => a.timestamp - b.timestamp);
        rawEntry.sort((a, b) => a.timestamp - b.timestamp);
        rawTP.sort((a, b)    => a.timestamp - b.timestamp);

        const pipSize  = getPipSize(symbol);
        // minRange: Crypto Daily=100 pips | XAUUSD 4H=100 pips | Forex 4H=50 pips
        const minRange = crypto ? 100 * pipSize : isGold ? 100 * pipSize : 50 * pipSize;
        // Extension guard lookback: Daily=10 bars (2 weeks), 4H=20 bars (3.3 days)
        const extLookback = crypto ? 10 : 20;

        const setups = [];
        const processedSweeps = new Set();
        let skipUntilMs = 0;

        // Walk through each sweep-TF candle in range
        for (let i = 1; i < rawSwp.length - 1; i++) {
            const cSwp = rawSwp[i];
            if (cSwp.timestamp < startMs || cSwp.timestamp > endMs) continue;
            if (cSwp.timestamp < skipUntilMs) continue;

            const sliceSwp = rawSwp.slice(0, i + 1);
            const sweep = detect4HSweep(sliceSwp, minRange);
            if (!sweep) continue;

            // Market bias filter using the appropriate EMA function (TF-agnostic)
            const trendSlice = rawSwp.slice(0, i + 1);
            const trend = getDailyTrend(trendSlice); // works on any TF with enough bars
            if (trend && sweep.direction !== trend) continue;

            if (isTrendOverExtended(trendSlice, sweep.direction, extLookback, 0.08)) continue;

            if (processedSweeps.has(sweep.confirmingTs)) continue;
            processedSweeps.add(sweep.confirmingTs);

            // Walk through entry-TF candles after the sweep
            const afterSweepMs = sweep.confirmingTs;
            const relevantEntry = rawEntry.filter(c => c.timestamp > afterSweepMs && c.timestamp <= endMs);
            if (relevantEntry.length < 4) continue;

            let entryResult = null;
            let retestCandle = null;
            const sweepStateForEntry = { ...sweep, sweepTimestamp: sweep.confirmingTs, symbol };
            // Max wait: 5 days for XAUUSD (1H entry), 10 days for others (4H entry)
            const maxWaitMs = (isGold ? 5 : 10) * 24 * 60 * 60 * 1000;

            for (let h = 6; h <= relevantEntry.length; h++) {
                const sliceEntry = rawEntry.filter(c => c.timestamp <= relevantEntry[h - 1].timestamp);
                entryResult = detect1HEntry(sliceEntry, sweepStateForEntry);
                if (entryResult) { retestCandle = relevantEntry[h - 1]; break; }
                if (relevantEntry[h - 1].timestamp - afterSweepMs > maxWaitMs) break;
            }

            if (!entryResult || !retestCandle) continue;

            // Find TP: no-lookahead slice of TP timeframe data
            const sliceTP = rawTP.filter(c => c.timestamp <= retestCandle.timestamp);
            const tpLabel = crypto ? 'Weekly Swing' : '4H Swing';
            const tpResult = sliceTP.length >= 5
                ? find4HLiquidityTP(sliceTP, entryResult.direction, entryResult.entryPrice, symbol, tpLabel)
                : null;

            const sl = entryResult.slPrice;
            const tp = tpResult ? tpResult.level : null;

            // Skip setups that have no valid Take Profit structure
            if (!tp) continue;

            // Minimum R:R = 1.5:1 — skip if TP doesn't justify the risk
            // e.g. Feb 26 BUY: R:R = 1.19 → not worth it
            const slDist = Math.abs(entryResult.entryPrice - sl);
            const tpDist = Math.abs(tp - entryResult.entryPrice);
            if (tpDist / slDist < 1.5) continue;

            // Evaluate outcome from the retest candle using entry-TF (or finer) candles
            let outcome = 'Pending';
            let resolutionTs = null;
            const postRetestCandles = rawEntry.filter(c => c.timestamp >= retestCandle.timestamp && c.timestamp <= endMs);

            for (let k = 0; k < Math.min(postRetestCandles.length, 600); k++) {
                const fh = p(postRetestCandles[k].high);
                const fl = p(postRetestCandles[k].low);

                if (entryResult.direction === 'BULLISH') {
                    if (fl <= sl) { outcome = 'Loss'; resolutionTs = postRetestCandles[k].timestamp; break; }
                    if (tp && fh >= tp) { outcome = 'Win';  resolutionTs = postRetestCandles[k].timestamp; break; }
                } else {
                    if (fh >= sl) { outcome = 'Loss'; resolutionTs = postRetestCandles[k].timestamp; break; }
                    if (tp && fl <= tp) { outcome = 'Win';  resolutionTs = postRetestCandles[k].timestamp; break; }
                }
            }

            // Pause scanning until this trade resolves (TP or SL)
            if (resolutionTs) skipUntilMs = resolutionTs;

            const action     = entryResult.direction === 'BULLISH' ? 'BUY' : 'SELL';
            const sweepLabel = crypto ? 'Daily Sweep' : '4H Sweep';
            const entryLabel = crypto ? '4H BOS' : '1H BOS';

            setups.push({
                datetime: sweep.confirmingDatetime,
                type: `${action} (CRT4)`,
                context: `${sweepLabel} → ${entryLabel} → ${entryResult.poi.type} Retest`,
                sweepLevel: entryResult.sweepExtreme.toFixed(5),
                bosLevel: entryResult.bosLevel.toFixed(5),
                poiType: entryResult.poi.type,
                entry: entryResult.entryPrice.toFixed(5),
                sl: sl.toFixed(5),
                tp: tp ? tp.toFixed(5) : 'Pending',
                tpSource: tpResult ? tpResult.source : 'Not found',
                outcome
            });
        }

        const wins = setups.filter(s => s.outcome === 'Win').length;
        const complete = setups.filter(s => s.outcome !== 'Pending').length;
        const winRate = complete > 0 ? ((wins / complete) * 100).toFixed(1) + '%' : '0%';

        return {
            candles: rawSwp.filter(c => c.timestamp >= startMs && c.timestamp <= endMs).length,
            setups: setups.length,
            winRate,
            recent: setups.slice(-10).reverse()
        };

    } catch (e) {
        console.error('[CRT4 Backtest Error]', e);
        return { error: e.message };
    }
}

module.exports = {
    crt4_scanDaily,    // Phase 1: Daily sweep detection
    crt4_scan4H,       // Phase 2+3: 4H BOS + POI entry detection
    crt4_findTP,       // TP: nearest unswept Weekly swing level
    runCRT4Backtest
};
