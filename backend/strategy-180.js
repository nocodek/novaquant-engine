const { fetchTV } = require('./tv-fetcher');

// Helper to calculate Simple Moving Average
function calculateSMA(data, period) {
    const sma = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += parseFloat(data[i - j].close);
        }
        sma[i] = sum / period;
    }
    return sma;
}

// Helper to calculate average body size over recent periods
function calculateAverageBodySize(data, period, currentIndex) {
    if (currentIndex < period) return 0;
    let sum = 0;
    for (let j = 1; j <= period; j++) {
        const c = data[currentIndex - j];
        sum += Math.abs(parseFloat(c.open) - parseFloat(c.close));
    }
    return sum / period;
}

async function run180Scanner(symbol) {
    try {
        // Fetch 5-minute data, we need at least 250 candles to compute 200 MA accurately + some history
        const data = await fetchTV(symbol, '5m', 300);
        
        if (data.length < 200) {
            return []; // Not enough data
        }

        const ma20 = calculateSMA(data, 20);
        const ma200 = calculateSMA(data, 200);
        const ma8 = calculateSMA(data, 8);

        const setups = [];

        // We only check the most recent completed candle (index: data.length - 2)
        // or the current live candle (data.length - 1) depending on how early we want to alert.
        // Oliver Velez says: "Buy the exact moment the green bar surpasses the high of the previous red bar."
        // This means the setup is actually forming on the CURRENT candle (index: data.length - 1).
        // The previous candle (index: data.length - 2) would be the "Elephant Bar".
        
        const currentIndex = data.length - 1;
        if (currentIndex < 200) return setups;

        const currentCandle = data[currentIndex];
        const prevCandle = data[currentIndex - 1];
        
        const prevOpen = parseFloat(prevCandle.open);
        const prevClose = parseFloat(prevCandle.close);
        const prevHigh = parseFloat(prevCandle.high);
        const prevLow = parseFloat(prevCandle.low);
        const prevBody = Math.abs(prevOpen - prevClose);
        
        const currentOpen = parseFloat(currentCandle.open);
        const currentClose = parseFloat(currentCandle.close);
        const currentHigh = parseFloat(currentCandle.high);
        const currentLow = parseFloat(currentCandle.low);
        const currentBody = Math.abs(currentOpen - currentClose);

        const avgBodySize = calculateAverageBodySize(data, 20, currentIndex - 1);
        
        // Define if previous bar is an "Elephant Bar". 
        // A simple rule: Body must be at least 1.5x larger than the average body size of last 20 candles
        const isElephantBar = prevBody > (avgBodySize * 1.5) && prevBody > 0;

        if (!isElephantBar) {
            return setups; // No setup if the previous bar wasn't an elephant bar
        }

        const currentMa20 = ma20[currentIndex];
        const currentMa200 = ma200[currentIndex];

        // Determine Location Strategy Context
        // Expansion: The elephant bar started very close to the 20MA
        // Snapback: The elephant bar is far from 20MA.
        let locationContext = "";
        const distanceTo20MA = Math.abs(prevClose - currentMa20) / currentMa20;
        
        // Let's use a dynamic threshold for "near" based on average body size relative to price
        const nearThreshold = (avgBodySize * 2) / prevClose; 
        
        if (distanceTo20MA <= nearThreshold) {
            locationContext = "Expansion (Near 20 MA)";
        } else if (distanceTo20MA > nearThreshold * 3) {
            locationContext = "Snapback (Far from 20 MA)";
        } else {
            locationContext = "Standard Setup";
        }

        // --- Bull 180 Setup ---
        // Prev Bar: Fat Red Bar.
        // Current Bar: Powerful Green Bar piercing the high of the Red Bar.
        const prevIsRed = prevClose < prevOpen;
        const currentIsGreen = currentClose > currentOpen;

        if (prevIsRed && currentIsGreen) {
            // Oliver Velez: "Buy the exact moment the green bar surpasses the high of the previous red bar."
            // We alert when the current high >= previous high.
            if (currentHigh >= prevHigh) {
                // To avoid repeated alerts for the same candle, we will rely on scanner's lastProcessed logic
                
                // Also check the 80% rule: If the elephant is massive, wait for 80% engulfing instead of 100%
                let entryPrice = prevHigh;
                const isGargantuan = prevBody > (avgBodySize * 3);
                if (isGargantuan) {
                    entryPrice = prevOpen - (prevBody * 0.2); // 80% up the red candle
                }

                if (currentHigh >= entryPrice) {
                    setups.push({
                        datetime: currentCandle.datetime,
                        type: 'BUY MARKET (Bull 180)',
                        entry: entryPrice.toFixed(5),
                        sl: Math.min(currentLow, prevLow).toFixed(5), // Stop below the green bar (or lowest of the two)
                        context: locationContext
                    });
                }
            }
        }

        // --- Bear 180 Setup ---
        // Prev Bar: Fat Green Bar.
        // Current Bar: Powerful Red Bar piercing the low of the Green Bar.
        const prevIsGreen = prevClose > prevOpen;
        const currentIsRed = currentClose < currentOpen;

        if (prevIsGreen && currentIsRed) {
            if (currentLow <= prevLow) {
                let entryPrice = prevLow;
                const isGargantuan = prevBody > (avgBodySize * 3);
                if (isGargantuan) {
                    entryPrice = prevOpen + (prevBody * 0.2); // 80% down the green candle
                }

                if (currentLow <= entryPrice) {
                    setups.push({
                        datetime: currentCandle.datetime,
                        type: 'SELL MARKET (Bear 180)',
                        entry: entryPrice.toFixed(5),
                        sl: Math.max(currentHigh, prevHigh).toFixed(5), // Stop above the red bar
                        context: locationContext
                    });
                }
            }
        }

        return setups;
    } catch (e) {
        console.error(`[180 Strategy] Error for ${symbol}:`, e);
        return [];
    }
}

module.exports = { run180Scanner };
