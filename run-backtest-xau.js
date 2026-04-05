/**
 * CRT4 Backtest Runner — XAUUSD (4 weeks)
 * Run: node run-backtest-xau.js
 */
require('dotenv').config();
const { runCRT4Backtest } = require('./backend/strategy-crt4');

async function run() {
    const symbol = 'XAU/USD';

    // 4-week window ending today (April 5, 2026)
    const endDate   = '2026-04-05';
    const startDate = '2026-03-08'; // exactly 4 weeks back

    console.log(`\n🟡 CRT4 Backtest — ${symbol}`);
    console.log(`📅 Period : ${startDate}  →  ${endDate}`);
    console.log('⏳ Fetching data from TradingView...\n');

    try {
        const result = await runCRT4Backtest(symbol, startDate, endDate);

        if (result.error) {
            console.error('❌ Backtest error:', result.error);
            process.exit(1);
        }

        console.log('═══════════════════════════════════════════════');
        console.log('  CRT4 BACKTEST  —  XAUUSD  (4 weeks)');
        console.log('═══════════════════════════════════════════════');
        console.log(`  Candles in range : ${result.candles}`);
        console.log(`  Total setups      : ${result.setups}`);
        console.log(`  Win Rate          : ${result.winRate}`);
        console.log('───────────────────────────────────────────────');

        if (result.recent && result.recent.length > 0) {
            console.log('\n  RECENT SETUPS (latest first):\n');
            result.recent.forEach((s, idx) => {
                const icon = s.outcome === 'Win' ? '✅' : s.outcome === 'Loss' ? '❌' : '⏳';
                console.log(`  [${idx + 1}] ${icon}  ${s.datetime}`);
                console.log(`       Type    : ${s.type}`);
                console.log(`       Context : ${s.context}`);
                console.log(`       Sweep   : ${s.sweepLevel}`);
                console.log(`       BOS     : ${s.bosLevel}`);
                console.log(`       POI     : ${s.poiType}`);
                console.log(`       Entry   : ${s.entry}`);
                console.log(`       SL      : ${s.sl}`);
                console.log(`       TP      : ${s.tp}  (${s.tpSource})`);
                console.log(`       Outcome : ${s.outcome}`);
                console.log();
            });
        } else {
            console.log('\n  ⚠️  No setups found in this 4-week window.\n');
        }

        console.log('═══════════════════════════════════════════════\n');

    } catch (err) {
        console.error('❌ Fatal error:', err.message);
        process.exit(1);
    }
}

run();
