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

async function run180BacktestData(symbol, startDate, endDate) {
    try {
        console.log(`[180 Engine] Fetching data for ${symbol}...`);
        
        const raw5m = await fetchTV(symbol, '5m', 15000, endDate); 
        
        const startMs = new Date(startDate + 'T00:00:00Z').getTime();
        const endMs = new Date(endDate + 'T23:59:59Z').getTime();
        
        if (raw5m.length < 250) {
           return { error: 'Insufficient 5m historical data to compute 200MA.' };
        }

        const ma20 = calculateSMA(raw5m, 20);
        const ma200 = calculateSMA(raw5m, 200);
        const ma8 = calculateSMA(raw5m, 8);

        let setups = [];
        let dataCountInRange = 0;

        for (let i = 200; i < raw5m.length - 1; i++) {
            const currentCandle = raw5m[i];
            
            // Only process candles inside the chosen date range
            if (currentCandle.timestamp < startMs || currentCandle.timestamp > endMs) {
                continue;
            }
            dataCountInRange++;

            const prevCandle = raw5m[i - 1];
            
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

            const avgBodySize = calculateAverageBodySize(raw5m, 20, i - 1);
            
            const isElephantBar = prevBody > (avgBodySize * 1.5) && prevBody > 0;
            if (!isElephantBar) continue;

            const currentMa20 = ma20[i];
            
            let locationContext = "";
            const distanceTo20MA = Math.abs(prevClose - currentMa20) / currentMa20;
            const nearThreshold = (avgBodySize * 2) / prevClose; 
            
            if (distanceTo20MA <= nearThreshold) {
                locationContext = "Expansion (Near 20 MA)";
            } else if (distanceTo20MA > nearThreshold * 3) {
                locationContext = "Snapback (Far from 20 MA)";
            } else {
                locationContext = "Standard Setup";
            }

            const prevIsRed = prevClose < prevOpen;
            const currentIsGreen = currentClose > currentOpen;
            const prevIsGreen = prevClose > prevOpen;
            const currentIsRed = currentClose < currentOpen;

            let setupFound = null;

            if (prevIsRed && currentIsGreen) {
                if (currentHigh >= prevHigh) {
                    let entryPrice = prevHigh;
                    const isGargantuan = prevBody > (avgBodySize * 3);
                    if (isGargantuan) {
                        entryPrice = prevOpen - (prevBody * 0.2); 
                    }
                    if (currentHigh >= entryPrice) {
                        setupFound = {
                            direction: 'BULLISH',
                            type: 'BUY MARKET (Bull 180)',
                            entry: entryPrice,
                            sl: Math.min(currentLow, prevLow),
                            context: locationContext,
                            datetime: currentCandle.datetime
                        };
                    }
                }
            } else if (prevIsGreen && currentIsRed) {
                if (currentLow <= prevLow) {
                    let entryPrice = prevLow;
                    const isGargantuan = prevBody > (avgBodySize * 3);
                    if (isGargantuan) {
                        entryPrice = prevOpen + (prevBody * 0.2); 
                    }
                    if (currentLow <= entryPrice) {
                        setupFound = {
                            direction: 'BEARISH',
                            type: 'SELL MARKET (Bear 180)',
                            entry: entryPrice,
                            sl: Math.max(currentHigh, prevHigh),
                            context: locationContext,
                            datetime: currentCandle.datetime
                        };
                    }
                }
            }

            if (setupFound) {
                // Simulate outcome
                let outcome = 'Pending';
                let dynamicSl = setupFound.sl;
                
                // Trail forward max 50 bars to see the outcome
                for (let k = i + 1; k < Math.min(i + 50, raw5m.length); k++) {
                    const fHigh = parseFloat(raw5m[k].high);
                    const fLow = parseFloat(raw5m[k].low);
                    const fClose = parseFloat(raw5m[k].close);
                    const fMa8 = ma8[k];
                    const fMa20 = ma20[k];

                    if (setupFound.direction === 'BULLISH') {
                        // Check static loss / trailing hit first
                        if (fLow <= dynamicSl) {
                            outcome = (dynamicSl > setupFound.entry) ? 'Win' : 'Loss';
                            break;
                        }
                        
                        // Check if Snapback target hit
                        if (locationContext.includes('Snapback') && fHigh >= fMa20) {
                            outcome = 'Win';
                            break; 
                        }
                        
                        // Trailing SL logic: if price clears 8MA, trail under 8MA
                        if (fClose > fMa8 && fMa8 > dynamicSl) {
                            // Give a small buffer under the 8MA, or exact tick
                            dynamicSl = fMa8;
                        }

                    } else if (setupFound.direction === 'BEARISH') {
                        if (fHigh >= dynamicSl) {
                            outcome = (dynamicSl < setupFound.entry) ? 'Win' : 'Loss';
                            break;
                        }
                        
                        // Check if Snapback target hit
                        if (locationContext.includes('Snapback') && fLow <= fMa20) {
                            outcome = 'Win';
                            break;
                        }
                        
                        if (fClose < fMa8 && fMa8 < dynamicSl) {
                            dynamicSl = fMa8;
                        }
                    }
                }

                setups.push({
                    datetime: setupFound.datetime,
                    type: setupFound.type,
                    context: setupFound.context,
                    entry: setupFound.entry.toFixed(5),
                    sl: setupFound.sl.toFixed(5),
                    outcome: outcome
                });
            }
        }
        
        const wins180 = setups.filter(s => s.outcome === 'Win').length;
        const complete180 = setups.filter(s => s.outcome !== 'Pending').length;
        const winRate180 = complete180 > 0 ? ((wins180 / complete180) * 100).toFixed(1) + '%' : '0%';

        return {
            candles: dataCountInRange,
            setups: setups.length,
            winRate: winRate180,
            recent: setups.slice(-10).reverse()
        };

    } catch (e) {
        console.error("180 Backtest Error:", e);
        return { error: e.message };
    }
}

module.exports = { run180Scanner, run180BacktestData };
