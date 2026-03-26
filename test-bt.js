require('dotenv').config();
const { runBacktestData } = require('./backend/backtest-api.js');

async function run() {
    console.log("Starting backtest...");
    const d = new Date();
    const today = d.toISOString().split('T')[0];
    d.setDate(d.getDate() - 30);
    const past = d.toISOString().split('T')[0];
    
    try {
        const res = await runBacktestData('XAU/USD', past, today);
        console.log("=== RESULTS ===");
        if (res.error) {
            console.error(res.error);
        } else {
            console.log("1H:", res["1h"].setups, "setups, Win Rate:", res["1h"].winRate);
            console.log("30m:", res["30m"].setups, "setups, Win Rate:", res["30m"].winRate);
        }
    } catch(e) {
        console.log(e);
    }
}
run();
