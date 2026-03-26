const admin = require('firebase-admin');

async function writeLog(level, message) {
  // Always log to standard console for Google Cloud platform logs
  if (level === 'ERROR') {
    console.error(`[${level}] ${message}`);
  } else {
    console.log(`[${level}] ${message}`);
  }

  try {
    const db = admin.firestore();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const estTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
    
    // We add an explicit ISO string to help the frontend order things cleanly if serverTimestamp is pending
    await db.collection('system_logs').add({
      level,
      message,
      timestamp,
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.error("Failed to write to system_logs:", err.message);
  }
}

const logger = {
  info: (msg) => writeLog('INFO', msg),
  error: (msg) => writeLog('ERROR', msg),
  warn: (msg) => writeLog('WARN', msg),
  success: (msg) => writeLog('SUCCESS', msg)
};

module.exports = logger;
