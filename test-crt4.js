/**
 * Quick CRT4 Backtest Runner
 * Usage: node test-crt4.js [SYMBOL] [START_DATE] [END_DATE]
 * Example: node test-crt4.js XAU/USD 2025-01-01 2025-03-31
 */

const { runCRT4Backtest } = require('./backend/strategy-crt4');

const symbol    = process.argv[2] || 'XAU/USD';
const startDate = process.argv[3] || '2025-01-01';
const endDate   = process.argv[4] || '2025-03-31';

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(` CRT4 Backtest: ${symbol}`);
console.log(` Period: ${startDate} → ${endDate}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

(async () => {
  try {
    const result = await runCRT4Backtest(symbol, startDate, endDate);

    if (result.error) {
      console.error('❌ Error:', result.error);
      process.exit(1);
    }

    console.log(`📊 4H Candles Scanned : ${result.candles}`);
    console.log(`🔍 Setups Found       : ${result.setups}`);
    console.log(`🏆 Win Rate           : ${result.winRate}`);
    console.log(`\n─── Last ${result.recent.length} Setup(s) ───────────────────────────\n`);

    result.recent.forEach((s, i) => {
      const outcomeIcon = s.outcome === 'Win' ? '✅' : s.outcome === 'Loss' ? '❌' : '⏳';
      console.log(`[${i + 1}] ${s.datetime}`);
      console.log(`    ${s.type} | ${s.context}`);
      console.log(`    Sweep: ${s.sweepLevel}  BOS: ${s.bosLevel}  POI: ${s.poiType}`);
      console.log(`    Entry: ${s.entry}  SL: ${s.sl}  TP: ${s.tp} (${s.tpSource})`);
      console.log(`    Outcome: ${outcomeIcon} ${s.outcome}\n`);
    });

    process.exit(0);
  } catch (err) {
    console.error('❌ Fatal:', err.message);
    process.exit(1);
  }
})();
