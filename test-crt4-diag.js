/**
 * CRT4 Diagnostic — checks what detect4HSweep actually finds on raw data
 */
const { fetchTV } = require('./backend/tv-fetcher');

function p(v) { return parseFloat(v); }

function detect4HSweep_verbose(data4h) {
    if (data4h.length < 4) return null;
    const n = data4h.length - 1;

    for (let offset = 0; offset <= 2; offset++) {
        const confirming = data4h[n - offset];
        const range = data4h[n - offset - 1];
        if (!confirming || !range) continue;

        const rangeHigh  = p(range.high), rangeLow = p(range.low), rangeClose = p(range.close);
        const confHigh   = p(confirming.high), confLow = p(confirming.low), confClose = p(confirming.close);

        const bullSweep  = confLow < rangeLow;
        const bullConfirm = confClose >= rangeClose;
        const bearSweep  = confHigh > rangeHigh;
        const bearConfirm = confClose <= rangeClose;

        console.log(`  offset=${offset} | range ${range.datetime} H:${rangeHigh} L:${rangeLow} C:${rangeClose}`);
        console.log(`           conf  ${confirming.datetime} H:${confHigh} L:${confLow} C:${confClose}`);
        console.log(`           BULL sweep=${bullSweep} confirm=${bullConfirm} | BEAR sweep=${bearSweep} confirm=${bearConfirm}`);

        if (bullSweep && bullConfirm) { console.log(`  ✅ BULLISH sweep found`); return 'BULLISH'; }
        if (bearSweep && bearConfirm) { console.log(`  ✅ BEARISH sweep found`); return 'BEARISH'; }
    }
    console.log(`  ❌ No sweep found`);
    return null;
}

(async () => {
    const symbol = process.argv[2] || 'XAU/USD';
    console.log(`\nFetching 4H data for ${symbol}...`);
    const raw4h = await fetchTV(symbol, '4h', 200);
    console.log(`Got ${raw4h.length} candles. Last 3:\n`);

    // Walk through a subset of candles in the date range and count sweeps found
    let sweepCount = 0;
    const startMs = new Date('2025-01-01T00:00:00Z').getTime();
    const endMs   = new Date('2025-03-31T23:59:59Z').getTime();

    const inRange = raw4h.filter(c => c.timestamp >= startMs && c.timestamp <= endMs);
    console.log(`Candles in range: ${inRange.length}`);

    for (let i = 2; i < inRange.length; i++) {
        const slice = raw4h.slice(0, raw4h.indexOf(inRange[i]) + 1);
        const prev = slice[slice.length - 2];
        const cur  = slice[slice.length - 1];
        
        const bullSweep  = p(cur.low) < p(prev.low) && p(cur.close) >= p(prev.close);
        const bearSweep  = p(cur.high) > p(prev.high) && p(cur.close) <= p(prev.close);

        if (bullSweep || bearSweep) {
            sweepCount++;
            console.log(`Sweep #${sweepCount}: ${cur.datetime} | ${bullSweep ? 'BULLISH' : 'BEARISH'}`);
            console.log(`  prev: H=${prev.high} L=${prev.low} C=${prev.close}`);
            console.log(`  cur:  H=${cur.high}  L=${cur.low}  C=${cur.close}\n`);
        }
    }
    console.log(`\nTotal sweeps in range: ${sweepCount}`);
    process.exit(0);
})();
