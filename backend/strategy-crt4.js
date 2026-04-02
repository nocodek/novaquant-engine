/**
 * CRT4 Strategy — Candle Range Theory 4H
 * ===========================================
 * Phase 1 (SCAN_4H):      Detect sweep of last 4H candle range + body confirmation
 * Phase 2 (SCAN_1H_BOS):  Wait for 1H break of structure (BOS) after sweep
 * Phase 3 (SCAN_1H_POI):  After BOS, wait for price to retrace into 1H OB/BB/FVG
 * Phase 4 (SCAN_DAILY_TP):Find Daily key level for TP target
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

        // ── OB / Breaker Block check ─────────────────────────────────────
        // An opposing candle is an OB if price passed straight through it,
        // or a BB (Breaker Block) if the impulse candles after it also
        // violated its extreme before the BOS — confirming the zone was "broken".
        const isBearCandle = p(c.close) < p(c.open);
        const isBullCandle = p(c.close) > p(c.open);

        if (direction === 'BULLISH' && isBearCandle) {
            // Check if any candle between this OB and the BOS violated its LOW
            // (i.e. price dipped back below the candle's low) → that makes it a BB
            let wasBroken = false;
            for (let k = j + 1; k <= bosIndex; k++) {
                if (p(data1h[k].low) < p(c.low)) { wasBroken = true; break; }
            }
            return {
                type: wasBroken ? 'BB' : 'OB',
                high: p(c.high), low: p(c.low),
                midpoint: (p(c.high) + p(c.low)) / 2
            };
        }

        if (direction === 'BEARISH' && isBullCandle) {
            let wasBroken = false;
            for (let k = j + 1; k <= bosIndex; k++) {
                if (p(data1h[k].high) > p(c.high)) { wasBroken = true; break; }
            }
            return {
                type: wasBroken ? 'BB' : 'OB',
                high: p(c.high), low: p(c.low),
                midpoint: (p(c.high) + p(c.low)) / 2
            };
        }
    }
    return null;
}

/**
 * TP = nearest Daily key level above entry (BULLISH) or below entry (BEARISH).
 * Scans Daily OBs, FVGs, and confirmed swing highs/lows.
 * Returns { level, source } or null.
 */
function findDailyTP(data4h, data1d, direction, entryPrice) {
    const levels = [];

    // ── Daily FVGs ──────────────────────────────────────────────────────
    for (let i = 2; i < data1d.length; i++) {
        const c0 = data1d[i];     // current
        const c2 = data1d[i - 2]; // two before
        // Bullish FVG (upside imbalance): gap between c2.high and c0.low
        if (p(c2.high) < p(c0.low)) {
            levels.push({ type: 'Daily FVG ↑', price: (p(c2.high) + p(c0.low)) / 2 });
        }
        // Bearish FVG (downside imbalance): gap between c2.low and c0.high
        if (p(c2.low) > p(c0.high)) {
            levels.push({ type: 'Daily FVG ↓', price: (p(c2.low) + p(c0.high)) / 2 });
        }
    }

    // ── Daily OBs ────────────────────────────────────────────────────────
    for (let i = 1; i < data1d.length; i++) {
        const c    = data1d[i];
        const prev = data1d[i - 1];
        // Demand OB: last red candle immediately before a bullish move
        if (p(c.close) > p(c.open) && p(prev.close) < p(prev.open)) {
            levels.push({ type: 'Daily OB ↑', price: p(prev.high) });
        }
        // Supply OB: last green candle immediately before a bearish move
        if (p(c.close) < p(c.open) && p(prev.close) > p(prev.open)) {
            levels.push({ type: 'Daily OB ↓', price: p(prev.low) });
        }
    }

    // ── Daily confirmed Swing Highs / Lows (2-bar each side) ─────────────
    for (let i = 2; i < data1d.length - 2; i++) {
        const h = p(data1d[i].high);
        if (
            p(data1d[i-2].high) < h && p(data1d[i-1].high) < h &&
            p(data1d[i+1].high) < h && p(data1d[i+2].high) < h
        ) {
            levels.push({ type: 'Daily Swing High', price: h });
        }
        const l = p(data1d[i].low);
        if (
            p(data1d[i-2].low) > l && p(data1d[i-1].low) > l &&
            p(data1d[i+1].low) > l && p(data1d[i+2].low) > l
        ) {
            levels.push({ type: 'Daily Swing Low', price: l });
        }
    }

    if (direction === 'BULLISH') {
        const above = levels.filter(l => l.price > entryPrice);
        if (above.length > 0) {
            const nearest = above.reduce((a, b) => a.price < b.price ? a : b);
            return { level: nearest.price, source: nearest.type };
        }
    } else {
        const below = levels.filter(l => l.price < entryPrice);
        if (below.length > 0) {
            const nearest = below.reduce((a, b) => a.price > b.price ? a : b);
            return { level: nearest.price, source: nearest.type };
        }
    }
    return null;
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
    if (direction === 'BULLISH') {
        // For OB: enter at the top of the OB zone. For FVG: enter at the midpoint.
        entryPrice = poi.type === 'FVG' ? poi.midpoint : poi.high;
        // SL = just below the sweep extreme
        slPrice = sweepExtreme - (p(data1h[afterSweepIdx].high) - p(data1h[afterSweepIdx].low)) * 0.1;
    } else {
        entryPrice = poi.type === 'FVG' ? poi.midpoint : poi.low;
        // SL = just above the sweep extreme
        slPrice = sweepExtreme + (p(data1h[afterSweepIdx].high) - p(data1h[afterSweepIdx].low)) * 0.1;
    }

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
 * Phase 1: Scan latest 4H candles for a CRT sweep.
 * Returns sweep state object or null.
 */
async function crt4_scan4H(symbol) {
    const data4h = await fetchTV(symbol, '4h', 50);
    if (!data4h || data4h.length < 5) return null;
    data4h.sort((a, b) => a.timestamp - b.timestamp);
    const minRange = 100 * getPipSize(symbol);
    return detect4HSweep(data4h, minRange);
}

/**
 * Phase 2+3: Called every 1H. Checks if BOS + POI retest has occurred.
 * Returns full entry object or null.
 */
async function crt4_scan1H(symbol, sweepState) {
    const data1h = await fetchTV(symbol, '1h', 200);
    if (!data1h || data1h.length < 10) return null;
    data1h.sort((a, b) => a.timestamp - b.timestamp);
    const normalised = { ...sweepState, sweepTimestamp: sweepState.sweepTimestamp || sweepState.confirmingTs };
    return detect1HEntry(data1h, normalised);
}

/**
 * Find TP = nearest Daily key level above/below entry.
 * Returns { level, source } or null.
 */
async function crt4_findTP(symbol, entryResult) {
    const [data4h, data1d] = await Promise.all([
        fetchTV(symbol, '4h',   100),
        fetchTV(symbol, '1day', 200)
    ]);
    if (!data4h || !data1d || data4h.length < 10 || data1d.length < 5) return null;
    data4h.sort((a, b) => a.timestamp - b.timestamp);
    data1d.sort((a, b) => a.timestamp - b.timestamp);
    return findDailyTP(data4h, data1d, entryResult.direction, entryResult.entryPrice);
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKTESTING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

async function runCRT4Backtest(symbol, startDate, endDate) {
    try {
        console.log(`[CRT4] Fetching data for backtest: ${symbol}...`);

        const [raw4h, raw1h, raw1d] = await Promise.all([
            fetchTV(symbol, '4h', 3000, endDate),
            fetchTV(symbol, '1h', 8000, endDate),
            fetchTV(symbol, '1day', 500, endDate)
        ]);

        const startMs = new Date(startDate + 'T00:00:00Z').getTime();
        const endMs   = new Date(endDate   + 'T23:59:59Z').getTime();

        if (raw4h.length < 10 || raw1h.length < 20 || raw1d.length < 10) {
            return { error: 'Insufficient data for CRT4 backtest.' };
        }

        // Sort all data ascending (oldest → newest) — TV returns newest first
        raw4h.sort((a, b) => a.timestamp - b.timestamp);
        raw1h.sort((a, b) => a.timestamp - b.timestamp);
        raw1d.sort((a, b) => a.timestamp - b.timestamp);

        const pipSize  = getPipSize(symbol);
        const minRange = 100 * pipSize;   // 100 pips minimum range

        const setups = [];
        const processedSweeps = new Set(); // prevent re-processing same sweep
        let skipUntilMs = 0;              // pause scanning while a trade is active

        // Walk through each 4H candle in range
        for (let i = 1; i < raw4h.length - 1; i++) {
            const c4h = raw4h[i];
            if (c4h.timestamp < startMs || c4h.timestamp > endMs) continue;
            if (c4h.timestamp < skipUntilMs) continue; // paused: previous trade still active

            // Run sweep detection on a slice ending at [i]
            const slice4h = raw4h.slice(0, i + 1);
            const sweep = detect4HSweep(slice4h, minRange);

            if (!sweep) continue;

            // Skip if we've already handled this exact sweep candle
            if (processedSweeps.has(sweep.confirmingTs)) continue;
            processedSweeps.add(sweep.confirmingTs);

            // Now walk through 1H candles that start after the sweep
            const afterSweepMs = sweep.confirmingTs;
            const relevantHours = raw1h.filter(c => c.timestamp > afterSweepMs && c.timestamp <= endMs);

            if (relevantHours.length < 4) continue;

            // Track which 1H candle triggered the POI retest (last in slice when entryResult fired)
            let entryResult = null;
            let retestCandle = null;
            const sweepStateForEntry = { ...sweep, sweepTimestamp: sweep.confirmingTs };

            for (let h = 6; h <= relevantHours.length; h++) {
                const slice1h = raw1h.filter(c => c.timestamp <= relevantHours[h - 1].timestamp);
                entryResult = detect1HEntry(slice1h, sweepStateForEntry);
                if (entryResult) {
                    retestCandle = relevantHours[h - 1]; // capture the retest candle
                    break;
                }
                // Bail if 5 days pass without a valid setup
                const elapsed = relevantHours[h - 1].timestamp - afterSweepMs;
                if (elapsed > 5 * 24 * 60 * 60 * 1000) break;
            }

            if (!entryResult || !retestCandle) continue;

            // Find TP = nearest Daily key level above/below entry
            const slice4hForTP = raw4h.slice(0, i + 1);
            const slice1dForTP = raw1d.filter(c => c.timestamp <= c4h.timestamp);
            const tpResult = findDailyTP(slice4hForTP, slice1dForTP, entryResult.direction, entryResult.entryPrice);

            const sl = entryResult.slPrice;
            const tp = tpResult ? tpResult.level : null;

            // Evaluate outcome starting FROM the retest candle
            // (detect1HEntry already confirmed price is in the POI zone at retestCandle)
            let outcome = 'Pending';
            let resolutionTs = null;
            const postRetestCandles = raw1h.filter(c => c.timestamp >= retestCandle.timestamp && c.timestamp <= endMs);

            for (let k = 0; k < Math.min(postRetestCandles.length, 300); k++) {
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

            const action = entryResult.direction === 'BULLISH' ? 'BUY' : 'SELL';

            setups.push({
                datetime: sweep.confirmingDatetime,
                type: `${action} (CRT4)`,
                context: `4H Sweep → 1H BOS → ${entryResult.poi.type} Retest`,
                sweepLevel: entryResult.sweepExtreme.toFixed(5),
                bosLevel: entryResult.bosLevel.toFixed(5),
                poiType: entryResult.poi.type,
                entry: entryResult.entryPrice.toFixed(5),
                sl: sl.toFixed(5),
                tp: tp ? tp.toFixed(5) : 'Pending',
                tpSource: tpResult ? tpResult.source : 'Not found',
                outcome
            });

            // Advance 4H index past this sweep to avoid re-using same range
            // (find next valid candle after entry window)
        }

        const wins = setups.filter(s => s.outcome === 'Win').length;
        const complete = setups.filter(s => s.outcome !== 'Pending').length;
        const winRate = complete > 0 ? ((wins / complete) * 100).toFixed(1) + '%' : '0%';

        return {
            candles: raw4h.filter(c => c.timestamp >= startMs && c.timestamp <= endMs).length,
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
    crt4_scan4H,
    crt4_scan1H,
    crt4_findTP,
    runCRT4Backtest
};
