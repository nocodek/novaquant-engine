const TradingView = require('@mathieuc/tradingview');
const client = new TradingView.Client();
const chart = new client.Session.Chart();
chart.setMarket('BINANCE:BTCUSD', { timeframe: '240', range: 10 });
try { chart.setTimezone('Europe/Paris'); console.log("Success setTimezone"); } catch(e) { console.log("Failed setTimezone", e.message); }
client.end();
