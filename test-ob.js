const { runBacktestData } = require('./backend/backtest-api.js');

async function test() {
    const today = new Date().toISOString().split('T')[0];
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const res = await runBacktestData('BTC/USD', past, today);
    const data30m = res['30m'];
    if (data30m && data30m.recent) {
        data30m.recent.forEach(r => {
            console.log(`Type: ${r.type}, IDM: ${r.idm}, Entry(OB): ${r.entry}`);
            if (r.type === 'BUY LIMIT') {
                if (parseFloat(r.entry) < parseFloat(r.idm)) {
                    console.log('✅ OB is BELOW IDM');
                } else {
                    console.log('❌ Error: OB is ABOVE/EQUAL to IDM');
                }
            } else {
                if (parseFloat(r.entry) > parseFloat(r.idm)) {
                    console.log('✅ OB is ABOVE IDM');
                } else {
                    console.log('❌ Error: OB is BELOW/EQUAL to IDM');
                }
            }
        });
    }
}
test();
