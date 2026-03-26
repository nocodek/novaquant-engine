const express = require('express');
const cors = require('cors');
const path = require('path');
const { startCronJobs } = require('./scanner');
const dotenv = require('dotenv');

dotenv.config();



const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Default settings
let activeSettings = {
  cryptoPairs: [
    'BTC/USD', 'XRP/USD'
  ],
  forexPairs: [
    'XAU/USD', 'EUR/JPY', 'USD/JPY', 'GBP/USD', 'GBP/JPY', 
    'NZD/USD', 'AUD/USD', 'AUD/CAD', 'EUR/USD', 'USD/CHF', 
    'CHF/JPY', 'EUR/GBP', 'USD/CAD', 'AUD/JPY', 'CAD/CHF', 
    'CAD/JPY'
  ]
};

app.get('/api/settings', (req, res) => {
  res.json(activeSettings);
});

app.post('/api/settings', (req, res) => {
  activeSettings = { ...activeSettings, ...req.body };
  res.json({ success: true, activeSettings });
});



const { runBacktestData } = require('./backtest-api');

app.post('/api/backtest', async (req, res) => {
  const { symbol, startDate, endDate } = req.body;
  if (!symbol || !startDate || !endDate) return res.status(400).json({ error: "Missing parameters" });
  try {
    const results = await runBacktestData(symbol, startDate, endDate);
    if (results.error) return res.json({ success: false, error: results.error });
    res.json({ success: true, symbol, data: results });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const { sendBacktestReport } = require('./telegram');

app.post('/api/telegram-backtest', async (req, res) => {
  const { symbol, results } = req.body;
  if (!symbol || !results) return res.status(400).json({ error: "Missing data" });
  try {
    const success = await sendBacktestReport(symbol, results);
    res.json({ success });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Pass an accessor so scanner can always get latest settings
const getSettings = () => activeSettings;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startCronJobs(getSettings);
});
