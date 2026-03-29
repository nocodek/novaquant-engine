const express = require('express');
const cors = require('cors');
const path = require('path');
const { startCronJobs } = require('./scanner');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

dotenv.config();

// Initialize Firebase Admin (Uses Default Credentials automatically on App Hosting)
admin.initializeApp();
const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Public health check endpoint for frontend status indicator
app.get('/api/status', (req, res) => {
  res.json({ status: 'online', timestamp: new Date() });
});

// Middleware to verify Firebase Auth token
const verifyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Default fallback settings for new users
const defaultSettings = {
  cryptoPairs: ['BTC/USD', 'XRP/USD'],
  forexPairs: [
    'XAU/USD', 'EUR/JPY', 'USD/JPY', 'GBP/USD', 'GBP/JPY', 
    'NZD/USD', 'AUD/USD', 'AUD/CAD', 'EUR/USD', 'USD/CHF', 
    'CHF/JPY', 'EUR/GBP', 'USD/CAD', 'AUD/JPY', 'CAD/CHF', 
    'CAD/JPY'
  ]
};

app.get('/api/settings', verifyAuth, async (req, res) => {
  try {
    const docRef = db.collection('users').doc(req.user.uid);
    const doc = await docRef.get();
    if (!doc.exists) {
      await docRef.set(defaultSettings);
      return res.json(defaultSettings);
    }
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', verifyAuth, async (req, res) => {
  try {
    const snapshot = await db.collection('system_logs')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
      
    const logs = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      logs.push({
        id: doc.id,
        level: data.level,
        message: data.message,
        time: data.createdAt
      });
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', verifyAuth, async (req, res) => {
  try {
    const docRef = db.collection('users').doc(req.user.uid);
    // Merge new settings with existing ones
    await docRef.set(req.body, { merge: true });
    
    // Fetch updated settings to return
    const updatedDoc = await docRef.get();
    res.json({ success: true, activeSettings: updatedDoc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



const { runBacktestData } = require('./backtest-api');
const { run180BacktestData } = require('./strategy-180');

app.post('/api/backtest', verifyAuth, async (req, res) => {
  const { symbol, startDate, endDate } = req.body;
  if (!symbol || !startDate || !endDate) return res.status(400).json({ error: "Missing parameters" });
  try {
    // Run MTF and both 180 strategies in parallel
    const [resultsMTF, results180_5m, results180_15m] = await Promise.all([
      runBacktestData(symbol, startDate, endDate),
      run180BacktestData(symbol, startDate, endDate, '5m'),
      run180BacktestData(symbol, startDate, endDate, '15m')
    ]);
    
    if (resultsMTF.error) {
      return res.json({ success: false, error: resultsMTF.error });
    }
    
    // Merge results
    const combinedResults = { ...resultsMTF };
    if (!results180_5m.error) {
       combinedResults["180 Plan (5m)"] = results180_5m;
    }
    if (!results180_15m.error) {
       combinedResults["180 Plan (15m)"] = results180_15m;
    }
    
    res.json({ success: true, symbol, data: combinedResults });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const { sendBacktestReport } = require('./telegram');

app.post('/api/telegram-backtest', verifyAuth, async (req, res) => {
  const { symbol, results } = req.body;
  if (!symbol || !results) return res.status(400).json({ error: "Missing data" });
  try {
    const success = await sendBacktestReport(symbol, results);
    res.json({ success });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Provide an accessor so the global scanner can get an aggregated list of unique pairs across all users
const getSettings = async () => {
  try {
    const snapshot = await db.collection('users').get();
    const allCrypto = new Set();
    const allForex = new Set();
    
    if (snapshot.empty) {
      return defaultSettings;
    }
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.cryptoPairs) data.cryptoPairs.forEach(p => allCrypto.add(p));
      if (data.forexPairs) data.forexPairs.forEach(p => allForex.add(p));
    });
    
    return {
      cryptoPairs: Array.from(allCrypto),
      forexPairs: Array.from(allForex)
    };
  } catch (err) {
    console.error('[Scanner] Failed to fetch aggregated settings from Firestore:', err);
    return defaultSettings;
  }
};

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startCronJobs(getSettings);
});
