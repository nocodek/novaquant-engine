const { fetchTV } = require('./tv-fetcher');

function processStrategyData(rawHTF, rawLTF, ltfInterval) {
    let setups = [];
    let htfIndex = 0;

    let activeBullishPOIs = [];
    let activeBearishPOIs = [];

    let state = 'WAITING_HTF_TAP';
    let tappedPOI = null;
    let sweepDirection = null; 
    let sweepExtreme = null;

    let tapIndex = null;
    let mssIndex = null;
    let mssPeak = null;
    let mssTrough = null;

    let idmLevel = null;
    let entryPrice = null;
    let tpLevel = null;
    
    let htfSwingHighs = [];
    let htfSwingLows = [];
    let ltfSwingHighs = [];
    let ltfSwingLows = [];

    let stat_taps = 0;
    let stat_mss = 0;
    let stat_bos = 0;
    let stat_entry = 0;

    let currentSetup = null;

    for (let i = 0; i < rawLTF.length; i++) {
        const cLTF = rawLTF[i];
        const cHigh = parseFloat(cLTF.high);
        const cLow = parseFloat(cLTF.low);
        const cClose = parseFloat(cLTF.close);
        const cOpen = parseFloat(cLTF.open);

        // 1. Advance HTF Data Stream and Calculate POIs
        while (htfIndex < rawHTF.length - 1 && rawHTF[htfIndex + 1].timestamp <= cLTF.timestamp) {
            htfIndex++;
            if (htfIndex >= 4) {
                const h0 = parseFloat(rawHTF[htfIndex].high), h1 = parseFloat(rawHTF[htfIndex-1].high), h2 = parseFloat(rawHTF[htfIndex-2].high), h3 = parseFloat(rawHTF[htfIndex-3].high), h4 = parseFloat(rawHTF[htfIndex-4].high);
                const l0 = parseFloat(rawHTF[htfIndex].low), l1 = parseFloat(rawHTF[htfIndex-1].low), l2 = parseFloat(rawHTF[htfIndex-2].low), l3 = parseFloat(rawHTF[htfIndex-3].low), l4 = parseFloat(rawHTF[htfIndex-4].low);
                const htfcClose = parseFloat(rawHTF[htfIndex].close);

                if (h2 > h0 && h2 > h1 && h2 > h3 && h2 > h4) htfSwingHighs.push({ price: h2, index: htfIndex-2 });
                if (l2 < l0 && l2 < l1 && l2 < l3 && l2 < l4) htfSwingLows.push({ price: l2, index: htfIndex-2 });

                // Daily FVGs (POI)
                const c0 = rawHTF[htfIndex];
                const c2 = rawHTF[htfIndex-2];
                if (parseFloat(c2.high) < parseFloat(c0.low)) {
                    activeBullishPOIs.push({ high: parseFloat(c0.low), low: parseFloat(c2.high), type: 'FVG' });
                }
                if (parseFloat(c2.low) > parseFloat(c0.high)) {
                    activeBearishPOIs.push({ high: parseFloat(c2.low), low: parseFloat(c0.high), type: 'FVG' });
                }

                // Daily BOS Bullish OB
                if (htfSwingHighs.length > 0) {
                    let lastSH = htfSwingHighs[htfSwingHighs.length - 1];
                    if (htfcClose > lastSH.price && !lastSH.broken) {
                        lastSH.broken = true;
                        let obHigh = 0; let obLow = Infinity;
                        for (let j = htfIndex; j >= lastSH.index; j--) {
                            if (parseFloat(rawHTF[j].close) < parseFloat(rawHTF[j].open)) {
                                obHigh = parseFloat(rawHTF[j].high);
                                obLow = parseFloat(rawHTF[j].low);
                                break;
                            }
                        }
                        if (obHigh > 0) activeBullishPOIs.push({ high: obHigh, low: obLow, type: 'OB' });
                    }
                }

                // Daily BOS Bearish OB
                if (htfSwingLows.length > 0) {
                    let lastSL = htfSwingLows[htfSwingLows.length - 1];
                    if (htfcClose < lastSL.price && !lastSL.broken) {
                        lastSL.broken = true;
                        let obHigh = 0; let obLow = Infinity;
                        for (let j = htfIndex; j >= lastSL.index; j--) {
                            if (parseFloat(rawHTF[j].close) > parseFloat(rawHTF[j].open)) {
                                obHigh = parseFloat(rawHTF[j].high);
                                obLow = parseFloat(rawHTF[j].low);
                                break;
                            }
                        }
                        if (obHigh > 0 && obLow !== Infinity) activeBearishPOIs.push({ high: obHigh, low: obLow, type: 'OB' });
                    }
                }
            }
        }

        // Clean mitigated POIs
        activeBullishPOIs = activeBullishPOIs.filter(poi => cClose > poi.low);
        activeBearishPOIs = activeBearishPOIs.filter(poi => cClose < poi.high);

        // 2. Track LTF Structural Swings
        if (i >= 4) {
            const h0 = parseFloat(rawLTF[i].high), h1 = parseFloat(rawLTF[i-1].high), h2 = parseFloat(rawLTF[i-2].high), h3 = parseFloat(rawLTF[i-3].high), h4 = parseFloat(rawLTF[i-4].high);
            if (h2 > h0 && h2 > h1 && h2 > h3 && h2 > h4) ltfSwingHighs.push({ price: h2, index: i-2 });
            
            const l0 = parseFloat(rawLTF[i].low), l1 = parseFloat(rawLTF[i-1].low), l2 = parseFloat(rawLTF[i-2].low), l3 = parseFloat(rawLTF[i-3].low), l4 = parseFloat(rawLTF[i-4].low);
            if (l2 < l0 && l2 < l1 && l2 < l3 && l2 < l4) ltfSwingLows.push({ price: l2, index: i-2 });
        }

        // 3. Execution State Machine
        if (state === 'WAITING_HTF_TAP') {
            tappedPOI = null;
            for (let poi of activeBullishPOIs) {
                if (cLow <= poi.high && cLow >= poi.low) {
                    state = 'WAITING_MSS'; sweepDirection = 'BULLISH'; sweepExtreme = cLow; tappedPOI = poi; stat_taps++; tapIndex = i; break;
                }
            }
            if (state === 'WAITING_HTF_TAP') {
                for (let poi of activeBearishPOIs) {
                    if (cHigh >= poi.low && cHigh <= poi.high) {
                        state = 'WAITING_MSS'; sweepDirection = 'BEARISH'; sweepExtreme = cHigh; tappedPOI = poi; stat_taps++; tapIndex = i; break;
                    }
                }
            }
        }

        if (state === 'WAITING_MSS') {
            if (sweepDirection === 'BULLISH') {
                sweepExtreme = Math.min(sweepExtreme, cLow);
                let recentHighs = ltfSwingHighs.filter(sh => sh.index >= tapIndex - 5 && sh.index < i);
                if (recentHighs.length > 0) {
                    let mssTarget = recentHighs[recentHighs.length - 1].price;
                    if (cClose > mssTarget) {
                        mssIndex = i; mssPeak = cHigh; state = 'WAITING_BOS'; stat_mss++;
                    }
                }
            } else if (sweepDirection === 'BEARISH') {
                sweepExtreme = Math.max(sweepExtreme, cHigh);
                let recentLows = ltfSwingLows.filter(sl => sl.index >= tapIndex - 5 && sl.index < i);
                if (recentLows.length > 0) {
                    let mssTarget = recentLows[recentLows.length - 1].price;
                    if (cClose < mssTarget) {
                        mssIndex = i; mssTrough = cLow; state = 'WAITING_BOS'; stat_mss++;
                    }
                }
            }
        }

        if (state === 'WAITING_BOS') {
            if (sweepDirection === 'BULLISH') {
                if (cLow <= sweepExtreme) { state = 'WAITING_HTF_TAP'; continue; }
                // BOS occurs when price closes above the highest point previously reached after MSS
                if (cClose > mssPeak && i > mssIndex + 2) { 
                    // Find the absolute lowest point between MSS and this BOS
                    let lowestPrice = Infinity;
                    let lowestIndex = -1;
                    for (let j = mssIndex; j < i; j++) {
                        if (parseFloat(rawLTF[j].low) < lowestPrice) {
                            lowestPrice = parseFloat(rawLTF[j].low);
                            lowestIndex = j;
                        }
                    }
                    if (lowestIndex !== -1 && lowestPrice < mssPeak) {
                        idmLevel = lowestPrice;
                        // Find OB below the Inducement
                        let obHigh = 0; let obLow = Infinity;
                        for (let j = lowestIndex; j >= tapIndex; j--) {
                            if (parseFloat(rawLTF[j].close) < parseFloat(rawLTF[j].open)) {
                                let cObHigh = parseFloat(rawLTF[j].high);
                                let cObLow = parseFloat(rawLTF[j].low);
                                if (cObHigh < idmLevel) {
                                    obHigh = cObHigh;
                                    obLow = cObLow;
                                    break;
                                }
                            }
                        }
                        if (obHigh > 0) entryPrice = obHigh;
                        else entryPrice = sweepExtreme + ((idmLevel - sweepExtreme) * 0.5); 
                        
                        tpLevel = cHigh; // The TP target is the top of this BOS breakout
                        state = 'WAITING_RETEST'; stat_bos++;
                    } else { state = 'WAITING_HTF_TAP'; continue; }
                } else {
                    mssPeak = Math.max(mssPeak, cHigh);
                }
            } else if (sweepDirection === 'BEARISH') {
                if (cHigh >= sweepExtreme) { state = 'WAITING_HTF_TAP'; continue; }
                if (cClose < mssTrough && i > mssIndex + 2) {
                    let highestPrice = 0;
                    let highestIndex = -1;
                    for (let j = mssIndex; j < i; j++) {
                        if (parseFloat(rawLTF[j].high) > highestPrice) {
                            highestPrice = parseFloat(rawLTF[j].high);
                            highestIndex = j;
                        }
                    }
                    if (highestIndex !== -1 && highestPrice > mssTrough) {
                        idmLevel = highestPrice;
                        let obHigh = 0; let obLow = Infinity;
                        for (let j = highestIndex; j >= tapIndex; j--) {
                            if (parseFloat(rawLTF[j].close) > parseFloat(rawLTF[j].open)) {
                                let cObHigh = parseFloat(rawLTF[j].high);
                                let cObLow = parseFloat(rawLTF[j].low);
                                if (cObLow > idmLevel) {
                                    obHigh = cObHigh;
                                    obLow = cObLow;
                                    break;
                                }
                            }
                        }
                        if (obHigh > 0 && obLow !== Infinity) entryPrice = obLow;
                        else entryPrice = sweepExtreme - ((sweepExtreme - idmLevel) * 0.5); 
                        
                        tpLevel = cLow; // TP is the bottom of the BOS breakdown
                        state = 'WAITING_RETEST'; stat_bos++;
                    } else { state = 'WAITING_HTF_TAP'; continue; }
                } else {
                    mssTrough = Math.min(mssTrough, cLow);
                }
            }
        }

        if (state === 'WAITING_RETEST') {
            // Keep extending TP if the trend continues without retesting entry
            if (sweepDirection === 'BULLISH') tpLevel = Math.max(tpLevel, cHigh);
            if (sweepDirection === 'BEARISH') tpLevel = Math.min(tpLevel, cLow);

            let triggered = false;
            if (sweepDirection === 'BULLISH' && cLow <= entryPrice) triggered = true;
            if (sweepDirection === 'BEARISH' && cHigh >= entryPrice) triggered = true;
            
            if (triggered) {
                currentSetup = {
                    datetime: cLTF.datetime,
                    type: sweepDirection === 'BULLISH' ? 'BUY LIMIT' : 'SELL LIMIT',
                    liquidityLevel: `Daily ${tappedPOI.type}`,
                    idm: idmLevel.toFixed(5),
                    entry: entryPrice.toFixed(5),
                    sl: sweepExtreme.toFixed(5),
                    tp1: tpLevel.toFixed(5),
                    tp2: tpLevel.toFixed(5),
                    outcome: 'Pending',
                    indexEntered: i
                };
                
                let resolved = false;
                for (let k = i + 1; k < Math.min(i + 200, rawLTF.length); k++) {
                    const fHigh = parseFloat(rawLTF[k].high);
                    const fLow = parseFloat(rawLTF[k].low);
                    if (sweepDirection === 'BULLISH') {
                        if (fLow <= sweepExtreme) { currentSetup.outcome = 'Loss'; resolved = true; break; }
                        if (fHigh >= tpLevel) { currentSetup.outcome = 'Win'; resolved = true; break; }
                    } else {
                        if (fHigh >= sweepExtreme) { currentSetup.outcome = 'Loss'; resolved = true; break; }
                        if (fLow <= tpLevel) { currentSetup.outcome = 'Win'; resolved = true; break; }
                    }
                }
                if (!resolved) currentSetup.outcome = 'Pending';
                setups.push(currentSetup);
                currentSetup = null;
                stat_entry++;
                state = 'WAITING_HTF_TAP';
            }
        }
    }
    
    return setups;
}

async function runBacktestData(symbol, startDate, endDate) {
    try {
        console.log(`[MTF Engine] Fetching Top-Down logic for ${symbol}...`);
        
        const raw1d = await fetchTV(symbol, '1day', 3000, endDate); 
        const raw1h = await fetchTV(symbol, '1h', 5000, endDate); 
        const raw30m = await fetchTV(symbol, '30m', 10000, endDate); 
        
        const startMs = new Date(startDate + 'T00:00:00Z').getTime();
        const endMs = new Date(endDate + 'T23:59:59Z').getTime();
        
        const data1d = raw1d.filter(c => c.timestamp >= startMs && c.timestamp <= endMs);
        const data1h = raw1h.filter(c => c.timestamp >= startMs && c.timestamp <= endMs);
        const data30m = raw30m.filter(c => c.timestamp >= startMs && c.timestamp <= endMs);
        
        if (data1h.length === 0 || data1d.length === 0 || data30m.length === 0) {
            return { error: `Insufficient historical overlap from TV for timeframe synchronization.` };
        }

        const setups1h = processStrategyData(raw1d, data1h, '1h');
        const setups30m = processStrategyData(raw1d, data30m, '30m');

        const wins1h = setups1h.filter(s => s.outcome === 'Win').length;
        const complete1h = setups1h.filter(s => s.outcome !== 'Pending').length;
        const winRate1h = complete1h > 0 ? ((wins1h / complete1h) * 100).toFixed(1) + '%' : '0%';

        const wins30m = setups30m.filter(s => s.outcome === 'Win').length;
        const complete30m = setups30m.filter(s => s.outcome !== 'Pending').length;
        const winRate30m = complete30m > 0 ? ((wins30m / complete30m) * 100).toFixed(1) + '%' : '0%';

        return {
            "1h": {
                candles: data1h.length,
                setups: setups1h.length,
                winRate: winRate1h,
                recent: setups1h.slice(-10).reverse()
            },
            "30m": {
                candles: data30m.length,
                setups: setups30m.length,
                winRate: winRate30m,
                recent: setups30m.slice(-10).reverse()
            }
        };

    } catch (e) {
        console.error("Backtest Error:", e);
        return { error: e.message };
    }
}

async function runLiveScannerData(symbol, ltfIndicator = '1h') {
    try {
        const raw1d = await fetchTV(symbol, '1day', 300); 
        const rawLtf = await fetchTV(symbol, ltfIndicator, 1500); 
        
        if (raw1d.length === 0 || rawLtf.length === 0) {
            return [];
        }

        return processStrategyData(raw1d, rawLtf, ltfIndicator);
    } catch (e) {
        console.error("Scanner Error:", e);
        return [];
    }
}

module.exports = { runBacktestData, runLiveScannerData };
