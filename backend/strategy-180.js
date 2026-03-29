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

function calculateAverageBodySize(data, period, currentIndex) {
    if (currentIndex < period) return 0;
    let sum = 0;
    for (let j = 1; j <= period; j++) {
        const c = data[currentIndex - j];
        sum += Math.abs(parseFloat(c.open) - parseFloat(c.close));
    }
    return sum / period;
}

function checkSwingHigh(data, index, lookback) {
    if (index < lookback || index + 1 > data.length) return false;
    const currentHigh = parseFloat(data[index].high);
    for (let j = 1; j <= lookback; j++) {
        if (parseFloat(data[index - j].high) > currentHigh) return false;
    }
    // Also check look-forward if needed, but since this is immediate detection, 
    // being the highest of the last N bars constitutes a potential swing high structure.
    return true;
}

function checkSwingLow(data, index, lookback) {
    if (index < lookback || index + 1 > data.length) return false;
    const currentLow = parseFloat(data[index].low);
    for (let j = 1; j <= lookback; j++) {
        if (parseFloat(data[index - j].low) < currentLow) return false;
    }
    return true;
}

function detect180Setup(data, currentIndex, ma20, ma200, avgBodySize) {
    const currentCandle = data[currentIndex];
    const prevCandle = data[currentIndex - 1];
    
    const prevOpen = parseFloat(prevCandle.open);
    const prevClose = parseFloat(prevCandle.close);
    const prevHigh = parseFloat(prevCandle.high);
    const prevLow = parseFloat(prevCandle.low);
    const prevBody = Math.abs(prevOpen - prevClose);
    const prevRange = prevHigh - prevLow;
    
    const currentOpen = parseFloat(currentCandle.open);
    const currentClose = parseFloat(currentCandle.close);
    const currentHigh = parseFloat(currentCandle.high);
    const currentLow = parseFloat(currentCandle.low);

    const isTrueElephant = prevBody >= (avgBodySize * 1.5) && prevBody > (prevRange * 0.5) && prevBody > 0;
    const isBabyBar = prevBody >= (avgBodySize * 0.5) && prevBody > 0;
    
    // Check if the previous bar (the one being engulfed) is at a swing extreme
    const isAtSwingHigh = checkSwingHigh(data, currentIndex - 1, 15);
    const isAtSwingLow = checkSwingLow(data, currentIndex - 1, 15);

    // Setup is valid if it's either a genuine elephant OR a baby bar at a swing point
    const validStructureBull = isTrueElephant || (isBabyBar && isAtSwingLow);
    const validStructureBear = isTrueElephant || (isBabyBar && isAtSwingHigh);
    
    if (!validStructureBull && !validStructureBear) return null;

    const currentMa20 = ma20[currentIndex];
    const currentMa200 = ma200[currentIndex];

    // Location strategy
    let locationContext = "";
    const distanceTo20MA = Math.abs(prevClose - currentMa20) / currentMa20;
    const nearThreshold = (avgBodySize * 2) / prevClose; 
    
    if (distanceTo20MA <= nearThreshold) {
        locationContext = "Expansion (Near 20 MA)";
    } else if (distanceTo20MA > nearThreshold * 4) { // Stricter snapback
        locationContext = "Snapback (Far from 20 MA)";
    } else {
        locationContext = "Standard Setup";
    }

    const prevIsRed = prevClose < prevOpen;
    const currentIsGreen = currentClose > currentOpen;
    const prevIsGreen = prevClose > prevOpen;
    const currentIsRed = currentClose < currentOpen;

    if (prevIsRed && currentIsGreen && validStructureBull) {
        // Refinement 2: Enforce solid engulfing body
        if (currentClose >= prevOpen && currentHigh >= prevHigh) {
            
            // Refinement 3: Macro Trend Alignment
            if (!locationContext.includes('Snapback') && currentClose < currentMa200) {
                return null;
            }

            let entryPrice = prevHigh;
            const isGargantuan = prevBody > (avgBodySize * 3);
            if (isGargantuan) {
                entryPrice = prevOpen - (prevBody * 0.2); 
            }
            if (currentHigh >= entryPrice) {
                return {
                    direction: 'BULLISH',
                    type: isTrueElephant ? 'BUY MARKET (Elephant 180)' : 'BUY MARKET (Swing Baby 180)',
                    entry: entryPrice,
                    sl: Math.min(currentLow, prevLow),
                    context: locationContext,
                    datetime: currentCandle.datetime
                };
            }
        }
    } else if (prevIsGreen && currentIsRed && validStructureBear) {
        // Refinement 2: Enforce solid engulfing body
        if (currentClose <= prevOpen && currentLow <= prevLow) {
            
            // Refinement 3: Macro Trend Alignment
            if (!locationContext.includes('Snapback') && currentClose > currentMa200) {
                return null;
            }

            let entryPrice = prevLow;
            const isGargantuan = prevBody > (avgBodySize * 3);
            if (isGargantuan) {
                entryPrice = prevOpen + (prevBody * 0.2); 
            }
            if (currentLow <= entryPrice) {
                return {
                    direction: 'BEARISH',
                    type: isTrueElephant ? 'SELL MARKET (Elephant 180)' : 'SELL MARKET (Swing Baby 180)',
                    entry: entryPrice,
                    sl: Math.max(currentHigh, prevHigh),
                    context: locationContext,
                    datetime: currentCandle.datetime
                };
            }
        }
    }

    return null;
}

async function run180Scanner(symbol, timeframe = '5m') {
    try {
        const data = await fetchTV(symbol, timeframe, 300);
        if (data.length < 200) return []; 

        const ma20 = calculateSMA(data, 20);
        const ma200 = calculateSMA(data, 200);

        const currentIndex = data.length - 1;
        const avgBodySize = calculateAverageBodySize(data, 20, currentIndex - 1);

        const setupFound = detect180Setup(data, currentIndex, ma20, ma200, avgBodySize);
        
        if (setupFound) {
            return [{
                datetime: setupFound.datetime,
                type: setupFound.type,
                entry: setupFound.entry.toFixed(5),
                sl: setupFound.sl.toFixed(5),
                context: setupFound.context
            }];
        }
        return [];
    } catch (e) {
        console.error(`[180 Strategy] Error for ${symbol}:`, e);
        return [];
    }
}

async function run180BacktestData(symbol, startDate, endDate, timeframe = '5m') {
    try {
        console.log(`[180 Engine] Fetching ${timeframe} data for ${symbol}...`);
        
        const rawData = await fetchTV(symbol, timeframe, 15000, endDate); 
        
        const startMs = new Date(startDate + 'T00:00:00Z').getTime();
        const endMs = new Date(endDate + 'T23:59:59Z').getTime();
        
        if (rawData.length < 250) {
           return { error: `Insufficient ${timeframe} historical data to compute 200MA.` };
        }

        const ma20 = calculateSMA(rawData, 20);
        const ma200 = calculateSMA(rawData, 200);
        const ma8 = calculateSMA(rawData, 8);

        let setups = [];
        let dataCountInRange = 0;

        for (let i = 200; i < rawData.length - 1; i++) {
            const currentCandle = rawData[i];
            
            if (currentCandle.timestamp < startMs || currentCandle.timestamp > endMs) {
                continue;
            }
            dataCountInRange++;

            const avgBodySize = calculateAverageBodySize(rawData, 20, i - 1);
            const setupFound = detect180Setup(rawData, i, ma20, ma200, avgBodySize);

            if (setupFound) {
                let outcome = 'Pending';
                let dynamicSl = setupFound.sl;
                
                // Trail forward max 50 bars to see the outcome
                for (let k = i + 1; k < Math.min(i + 50, rawData.length); k++) {
                    const fHigh = parseFloat(rawData[k].high);
                    const fLow = parseFloat(rawData[k].low);
                    const fClose = parseFloat(rawData[k].close);
                    const fMa8 = ma8[k];
                    const fMa20 = ma20[k];

                    if (setupFound.direction === 'BULLISH') {
                        if (fLow <= dynamicSl) {
                            outcome = (dynamicSl > setupFound.entry) ? 'Win' : 'Loss';
                            break;
                        }
                        
                        if (setupFound.context.includes('Snapback') && fHigh >= fMa20) {
                            outcome = 'Win';
                            break; 
                        }
                        
                        if (fClose > fMa8 && fMa8 > dynamicSl) {
                            dynamicSl = fMa8;
                        }

                    } else if (setupFound.direction === 'BEARISH') {
                        if (fHigh >= dynamicSl) {
                            outcome = (dynamicSl < setupFound.entry) ? 'Win' : 'Loss';
                            break;
                        }
                        
                        if (setupFound.context.includes('Snapback') && fLow <= fMa20) {
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
