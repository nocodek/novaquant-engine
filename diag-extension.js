/**
 * Diagnostic: verify pip distances for the extension guard
 */
require('dotenv').config();
const { fetchTV } = require('./backend/tv-fetcher');

function p(v) { return parseFloat(v); }

function getPipSize(symbol) {
    const s = (symbol || '').toUpperCase();
    if (/XAU|GOLD/.test(s)) return 0.1;
    return 0.0001;
}

async function run() {
    const symbol = 'XAU/USD';
    const endDate = '2026-04-05';
    
    console.log('Fetching 4H data...');
    const raw4h = await fetchTV(symbol, '4h', 1000, endDate);
    raw4h.sort((a, b) => a.timestamp - b.timestamp);
    
    const startMs = new Date('2026-03-08T00:00:00Z').getTime();
    const endMs = new Date('2026-04-05T23:59:59Z').getTime();
    
    const pipSize = getPipSize(symbol);
    
    // Check pip distances for each candle in the range
    for (let i = 20; i < raw4h.length; i++) {
        const c = raw4h[i];
        if (c.timestamp < startMs || c.timestamp > endMs) continue;
        
        const slice = raw4h.slice(Math.max(0, i - 19), i + 1); // last 20 bars
        const lastClose = p(c.close);
        
        // BEARISH check
        const legTop = Math.max(...slice.map(x => p(x.high)));
        const bearDist = legTop - lastClose;
        const bearPips = bearDist / pipSize;
        
        // BULLISH check
        const legBottom = Math.min(...slice.map(x => p(x.low)));
        const bullDist = lastClose - legBottom;
        const bullPips = bullDist / pipSize;
        
        console.log(`[${c.datetime}] close=${lastClose.toFixed(2)} | BEAR dist from top(${legTop.toFixed(2)})=${bearPips.toFixed(0)} pips | BULL dist from bot(${legBottom.toFixed(2)})=${bullPips.toFixed(0)} pips`);
    }
}

run().catch(console.error);
