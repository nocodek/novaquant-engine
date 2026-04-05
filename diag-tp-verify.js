/**
 * TP Level Verification — prints the swing lows/highs that were visible
 * at each setup date so we can cross-check against the TradingView chart.
 */
require('dotenv').config();
const { fetchTV } = require('./backend/tv-fetcher');

function p(v) { return parseFloat(v); }

function is4HSwingHigh(data, i, n = 3) {
    const h = p(data[i].high);
    for (let j = i - n; j < i; j++) { if (!data[j] || p(data[j].high) >= h) return false; }
    for (let j = i + 1; j <= i + n; j++) { if (!data[j] || p(data[j].high) >= h) return false; }
    return true;
}
function is4HSwingLow(data, i, n = 3) {
    const l = p(data[i].low);
    for (let j = i - n; j < i; j++) { if (!data[j] || p(data[j].low) <= l) return false; }
    for (let j = i + 1; j <= i + n; j++) { if (!data[j] || p(data[j].low) <= l) return false; }
    return true;
}

const SETUPS = [
    { date: '2026-03-09T15:00:00Z', label: 'Setup 1 BUY  Mar 09', direction: 'BULLISH', entry: 5191.95, tp: 5206.10 },
    { date: '2026-03-12T11:00:00Z', label: 'Setup 2 SELL Mar 12', direction: 'BEARISH', entry: 5104.33, tp: 5014.58 },
    { date: '2026-03-16T07:00:00Z', label: 'Setup 3 SELL Mar 16', direction: 'BEARISH', entry: 4984.81, tp: 4841.90 },
    { date: '2026-03-18T07:00:00Z', label: 'Setup 4 SELL Mar 18', direction: 'BEARISH', entry: 4850.52, tp: 4654.86 },
    { date: '2026-03-25T03:00:00Z', label: 'Setup 5 SELL Mar 25', direction: 'BEARISH', entry: 4541.22, tp: 4305.94 },
    { date: '2026-03-31T11:00:00Z', label: 'Setup 6 BUY  Mar 31', direction: 'BULLISH', entry: 4682.30, tp: 4735.93 },
];

async function run() {
    const symbol = 'XAU/USD';
    console.log('Fetching 4H data...\n');
    const raw4h = await fetchTV(symbol, '4h', 1000, '2026-04-05');
    raw4h.sort((a, b) => a.timestamp - b.timestamp);

    for (const setup of SETUPS) {
        const setupTs = new Date(setup.date).getTime();
        // Slice: everything UP TO and including the setup candle
        const slice = raw4h.filter(c => c.timestamp <= setupTs);

        const minDist = 10; // 100 pips × 0.1 pipsize = 10 (for XAU)
        const candidates = [];

        for (let i = 3; i < slice.length - 3; i++) {
            if (setup.direction === 'BULLISH' && is4HSwingHigh(slice, i, 3)) {
                const h = p(slice[i].high);
                if (h < setup.entry + minDist) continue;
                const swept = slice.slice(i + 1).some(fc => p(fc.high) > h);
                if (!swept) candidates.push({ price: h, dt: slice[i].datetime, source: 'SwingHigh' });
            }
            if (setup.direction === 'BEARISH' && is4HSwingLow(slice, i, 3)) {
                const l = p(slice[i].low);
                if (l > setup.entry - minDist) continue;
                const swept = slice.slice(i + 1).some(fc => p(fc.low) < l);
                if (!swept) candidates.push({ price: l, dt: slice[i].datetime, source: 'SwingLow' });
            }
        }

        let selectedTP = null;
        if (setup.direction === 'BULLISH') {
            const above = candidates.filter(c => c.price > setup.entry + minDist);
            if (above.length > 0) selectedTP = above.reduce((a, b) => a.price < b.price ? a : b);
        } else {
            const below = candidates.filter(c => c.price < setup.entry - minDist);
            if (below.length > 0) selectedTP = below.reduce((a, b) => a.price > b.price ? a : b);
        }

        const match = selectedTP && Math.abs(selectedTP.price - setup.tp) < 1 ? '✅ MATCH' : '❌ MISMATCH';
        console.log(`─── ${setup.label} ─────────────────────────────────`);
        console.log(`  Entry       : ${setup.entry}`);
        console.log(`  Backtest TP : ${setup.tp}`);
        console.log(`  Computed TP : ${selectedTP ? selectedTP.price.toFixed(2) : 'NOT FOUND'} (from ${selectedTP?.dt || '—'})`);
        console.log(`  Status      : ${match}`);
        // Show all candidate swing levels
        const top5 = candidates.slice(-5).reverse();
        console.log(`  Nearest candidates (${setup.direction === 'BEARISH' ? 'swing lows below entry' : 'swing highs above entry'}):`);
        top5.forEach(c => console.log(`    → ${c.price.toFixed(2)} @ ${c.dt}`));
        console.log('');
    }
}

run().catch(console.error);
