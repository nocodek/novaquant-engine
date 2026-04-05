const TradingView = require('@mathieuc/tradingview');

const cache = {};
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

function getTVSymbol(pair) {
  const clean = pair.replace('/', '');
  // Basic heuristic: Cryptocurrencies pull from Binance, Forex pulls from Pepperstone
  if (['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'].some(c => clean.includes(c))) {
    return `BINANCE:${clean}`;
  }
  return `PEPPERSTONE:${clean}`;
}

async function _fetchTVInternal(symbol, interval, amount, endDateStr) {
  return new Promise((resolve, reject) => {
    const client = new TradingView.Client();
    const chart = new client.Session.Chart();
    
    // Support MTF mappings
    const tvMap = { '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1D': 'D', '1W': 'W' };
    const tvTimeframe = tvMap[interval] || 'D'; // Default to Daily if unrecognised

    // TV typically limits single requests to ~5000 max.
    const initialRequest = amount > 5000 ? 5000 : amount;

    const options = {
      timeframe: tvTimeframe,
      range: initialRequest
    };
    if (endDateStr) {
      options.to = Math.round(new Date(endDateStr + 'T23:59:59Z').getTime() / 1000);
    }

    chart.setMarket(getTVSymbol(symbol), options);
    
    chart.setTimezone('Africa/Lagos');

    let timeout = setTimeout(() => {
      client.end();
      reject(new Error("TradingView data fetch timed out."));
    }, 20000); // Increased timeout to 20 seconds

    let isResolving = false;
    let lastPeriodCount = 0;

    const finalizeAndResolve = () => {
       if (isResolving) return;
       isResolving = true;
       clearTimeout(timeout);
       
       const formattedData = chart.periods.map(p => ({
         timestamp: p.time * 1000,
         datetime: new Date(p.time * 1000).toLocaleString('sv-SE', { timeZone: 'Africa/Lagos' }).replace(/[T,]/g, ' ').trim().substring(0, 19),
         open: p.open,
         high: p.max,
         low: p.min,
         close: p.close
       }));
       
       client.end();
       resolve(formattedData);
    };

    chart.onUpdate(() => {
      if (!chart.periods || chart.periods.length === 0) return;
      
      // Batch Fetching Mechanics
      if (chart.periods.length < amount && chart.periods.length > lastPeriodCount) {
          lastPeriodCount = chart.periods.length;
          const remaining = amount - chart.periods.length;
          const chunk = remaining > 5000 ? 5000 : remaining;
          
          chart.fetchMore(chunk);
          
          // Reset timeout for the next chunk
          clearTimeout(timeout);
          timeout = setTimeout(finalizeAndResolve, 15000); // 15 seconds for chunk fetch
          return;
      }
      
      finalizeAndResolve();
    });
    
    chart.onError(err => {
      clearTimeout(timeout);
      client.end();
      reject(err);
    });
  });
}

async function fetchTV(symbol, interval, amount = 100, endDateStr = null) {
  // Only cache live data requests (when endDateStr is null)
  const cacheKey = !endDateStr ? `${symbol}-${interval}-${amount}` : null;
  
  if (cacheKey && cache[cacheKey]) {
      const { data, timestamp } = cache[cacheKey];
      if (Date.now() - timestamp < CACHE_TTL) {
          console.log(`[Cache] Using cached data for ${cacheKey}`);
          return data;
      }
  }

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const formattedData = await _fetchTVInternal(symbol, interval, amount, endDateStr);
      
      if (cacheKey) {
          cache[cacheKey] = { data: formattedData, timestamp: Date.now() };
      }
      return formattedData;
    } catch (err) {
      if (attempt === maxRetries) {
        throw err;
      }
      console.warn(`[TV Fetcher] Error fetching ${symbol} ${interval}. Retrying (${attempt}/${maxRetries})...`);
      await new Promise(res => setTimeout(res, 2000 * attempt)); // Exponential backoff 2s, 4s...
    }
  }
}

module.exports = { fetchTV, getTVSymbol };
