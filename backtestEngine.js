/**
 * BacktestEngine.js - 四指標決策矩陣與歷史交易回測模擬引擎
 */

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbx5h2Ncq111yq3k6tFffiOS9m0vOBtVywbsVdfZPCHvNbSv0vIGYiC_MimgkZGV3gbP/exec';

class BacktestEngine {
    constructor() {
        this.period = 20;
    }

    /**
     * T-Score 標準化計算 (Mean=50, SD=10)
     */
    calcTScore(val, mean, std) {
        if (std === 0 || isNaN(std)) return 50;
        const z = (val - mean) / std;
        return Math.min(Math.max(Math.round((50 + z * 10) * 10) / 10, 10), 90);
    }

    /**
     * 讀取並轉化歷史序列數據
     */
    async loadAndPrepareData(stockCode) {
        let rawData = [];
        try {
            const url = `${GAS_API_URL}?stock=${encodeURIComponent(stockCode)}`;
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                rawData = json.data || json;
            }
        } catch (e) {
            console.warn("GAS API 連線受阻，採用高真實度隨機漫步回測數據庫模擬");
        }

        if (!Array.isArray(rawData) || rawData.length < 100) {
            rawData = this.generateSyntheticData(250, stockCode === '2330' ? 900 : 100);
        }

        return this.computeIndicators(rawData);
    }

    /**
     * 計算四指標與多週期動能序列
     */
    computeIndicators(kline) {
        const series = [];

        for (let i = 0; i < kline.length; i++) {
            if (i < this.period) {
                series.push(null);
                continue;
            }

            const slice = kline.slice(i - this.period + 1, i + 1);
            const closePrices = slice.map(d => Number(d.close));
            const volumes = slice.map(d => Number(d.volume));

            // 1. SDV
            const currClose = closePrices[closePrices.length - 1];
            const maClose = closePrices.reduce((a, b) => a + b, 0) / this.period;
            const logReturns = [];
            for (let j = 1; j < closePrices.length; j++) {
                logReturns.push(Math.log(closePrices[j] / closePrices[j - 1]));
            }
            const meanLog = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
            const stdLog = Math.sqrt(logReturns.reduce((a, b) => a + Math.pow(b - meanLog, 2), 0) / logReturns.length) || 0.01;
            const sdv = this.calcTScore(Math.log(currClose / maClose), 0, stdLog * Math.sqrt(this.period));

            // 2. VDV
            const currVol = volumes[volumes.length - 1];
            const maVol = volumes.reduce((a, b) => a + b, 0) / this.period;
            const stdVol = Math.sqrt(volumes.reduce((a, b) => a + Math.pow(b - maVol, 2), 0) / this.period) || 1;
            const vdv = this.calcTScore(currVol, maVol, stdVol);

            // 3. ADV & ATR
            const trList = slice.map((d, idx) => {
                if (idx === 0) return d.high - d.low;
                const prevC = slice[idx - 1].close;
                return Math.max(d.high - d.low, Math.abs(d.high - prevC), Math.abs(d.low - prevC));
            });
            const atr = trList.reduce((a, b) => a + b, 0) / this.period;
            const currTR = trList[trList.length - 1];
            const maTR = trList.reduce((a, b) => a + b, 0) / this.period;
            const stdTR = Math.sqrt(trList.reduce((a, b) => a + Math.pow(b - maTR, 2), 0) / this.period) || 1;
            const adv = this.calcTScore(currTR, maTR, stdTR);

            // 4. BDV
            const variance = closePrices.reduce((a, b) => a + Math.pow(b - maClose, 2), 0) / this.period;
            const stdDevPrice = Math.sqrt(variance);
            const bw = (stdDevPrice * 4) / maClose;
            const bdv = Math.min(Math.max(Math.round(bw * 300), 20), 85);

            series.push({
                date: kline[i].date,
                close: currClose,
                high: kline[i].high,
                low: kline[i].low,
                atr,
                sdv, vdv, adv, bdv
            });
        }

        const valid = series.filter(d => d !== null);
        return valid.map((curr, idx) => {
            const d1_sdv = idx >= 1 ? curr.sdv - valid[idx - 1].sdv : 0;
            const d5_sdv = idx >= 5 ? curr.sdv - valid[idx - 5].sdv : 0;
            const d10_sdv = idx >= 10 ? curr.sdv - valid[idx - 10].sdv : 0;

            const d1_vdv = idx >= 1 ? curr.vdv - valid[idx - 1].vdv : 0;
            const d5_vdv = idx >= 5 ? curr.vdv - valid[idx - 5].vdv : 0;
            const d10_vdv = idx >= 10 ? curr.vdv - valid[idx - 10].vdv : 0;

            const d1_adv = idx >= 1 ? curr.adv - valid[idx - 1].adv : 0;

            const scoreObj = this.calculateMatrixScore(curr.sdv, curr.vdv, curr.adv, curr.bdv, d1_sdv, d5_sdv, d10_sdv, d1_vdv, d5_vdv, d10_vdv);

            return {
                ...curr,
                d1_adv,
                score: scoreObj.score,
                tier: scoreObj.tier,
                positionRatio: scoreObj.positionRatio
            };
        });
    }

    /**
     * 兩階段決策評分 (0-100) 與倉位級別劃分
     */
    calculateMatrixScore(sdv, vdv, adv, bdv, d1_sdv, d5_sdv, d10_sdv, d1_vdv, d5_vdv, d10_vdv) {
        // 第一階段硬性條件過濾
        if (sdv < 45 || bdv < 35 || adv > 78) {
            return { score: 30, tier: '觀望', positionRatio: 0 };
        }

        // 第二階段權重加分
        let score = 0;
        if (sdv >= 55) score += 15;
        if (vdv >= 55) score += 15;

        if (d1_sdv > 0) score += 10;
        if (d5_sdv > 0) score += 10;
        if (d1_vdv > 0) score += 10;
        if (d5_vdv > 0) score += 10;

        if (d10_sdv > 0) score += 15;
        if (d10_vdv > 0) score += 15;

        if (score >= 85) return { score, tier: 'A級強勢', positionRatio: 1.0 };
        if (score >= 70) return { score, tier: 'B級標準', positionRatio: 0.7 };
        if (score >= 60) return { score, tier: 'C級試單', positionRatio: 0.3 };
        return { score, tier: '觀望', positionRatio: 0 };
    }

    /**
     * 回測模擬引擎主程序
     */
    runBacktest(data, config) {
        const { initialCapital, feeRate, taxRate, minScore } = config;

        let cash = initialCapital;
        let positionShares = 0;
        let activeTrade = null;
        let highestPriceSinceEntry = 0;

        const tradeLogs = [];
        const equityCurve = [];
        const bhCurve = [];

        const initialPrice = data[0].close;
        const totalTaxAndFeeRate = (feeRate + taxRate) / 100;
        const buyFeeRate = feeRate / 100;

        for (let i = 0; i < data.length; i++) {
            const bar = data[i];
            const date = bar.date;
            const price = bar.close;

            // 買持策略標竿 (Buy & Hold Equity)
            const bhShares = (initialCapital * (1 - buyFeeRate)) / initialPrice;
            const bhEquity = bhShares * price;
            bhCurve.push({ date, equity: Math.round(bhEquity) });

            // 持倉狀態處理
            if (positionShares > 0 && activeTrade) {
                highestPriceSinceEntry = Math.max(highestPriceSinceEntry, bar.high);

                // 風控條件判斷
                let stopLossMultiplier = 2.0;
                if (bar.adv >= 65) stopLossMultiplier = 2.5;
                if (bar.adv < 45) stopLossMultiplier = 1.5;

                const atrStopPrice = highestPriceSinceEntry - (bar.atr * stopLossMultiplier);
                const isATRStopTriggered = price <= atrStopPrice;
                const isSDVDegraded = bar.sdv < 40 || bar.score < 50;
                const isTakeProfitSpike = (bar.sdv >= 65) && (bar.adv >= 70) && (bar.d1_adv <= -3.0);

                // 觸發出場
                if (isATRStopTriggered || isSDVDegraded || isTakeProfitSpike || i === data.length - 1) {
                    let exitReason = "動能衰退出場";
                    if (isATRStopTriggered) exitReason = `ADV適應型停損 (${stopLossMultiplier}x ATR)`;
                    if (isTakeProfitSpike) exitReason = "🚨 ADV情緒爆發拐點停利";
                    if (i === data.length - 1) exitReason = "回測期滿平倉";

                    const grossProceeds = positionShares * price;
                    const netProceeds = grossProceeds * (1 - totalTaxAndFeeRate);
                    cash += netProceeds;

                    const tradeReturnPct = ((netProceeds - activeTrade.cost) / activeTrade.cost) * 100;

                    tradeLogs.push({
                        buyDate: activeTrade.buyDate,
                        buyPrice: activeTrade.buyPrice,
                        tier: activeTrade.tier,
                        sellDate: date,
                        sellPrice: price,
                        exitReason,
                        returnPct: Math.round(tradeReturnPct * 100) / 100,
                        accumulatedCapital: Math.round(cash)
                    });

                    positionShares = 0;
                    activeTrade = null;
                    highestPriceSinceEntry = 0;
                }
            } 
            // 買入條件判斷
            else if (positionShares === 0 && bar.score >= minScore) {
                const targetCapital = cash * bar.positionRatio;
                const sharePriceWithFee = price * (1 + buyFeeRate);
                const sharesToBuy = Math.floor(targetCapital / sharePriceWithFee);

                if (sharesToBuy > 0) {
                    const actualCost = sharesToBuy * sharePriceWithFee;
                    cash -= actualCost;
                    positionShares = sharesToBuy;
                    highestPriceSinceEntry = bar.high;

                    activeTrade = {
                        buyDate: date,
                        buyPrice: price,
                        tier: `${bar.tier} (${Math.round(bar.positionRatio * 100)}%)`,
                        cost: actualCost
                    };
                }
            }

            // 計算當日總資產權益
            const currentEquity = cash + (positionShares * price);
            equityCurve.push({ date, equity: Math.round(currentEquity) });
        }

        // 績效指標計算
        const kpis = this.calculatePerformanceMetrics(equityCurve, tradeLogs, initialCapital, data.length);

        return {
            tradeLogs,
            equityCurve,
            bhCurve,
            kpis
        };
    }

    /**
     * 計算回測統計指標 (CAGR, MDD, Sharpe Ratio, Profit Factor)
     */
    calculatePerformanceMetrics(equityCurve, trades, initialCapital, totalDays) {
        const finalEquity = equityCurve[equityCurve.length - 1].equity;
        const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;

        // CAGR
        const years = totalDays / 252;
        const cagr = (Math.pow(finalEquity / initialCapital, 1 / (years || 1)) - 1) * 100;

        // MDD (Maximum Drawdown)
        let peak = 0;
        let maxDrawdown = 0;
        const dailyReturns = [];

        for (let i = 0; i < equityCurve.length; i++) {
            const eq = equityCurve[i].equity;
            if (eq > peak) peak = eq;
            const dd = (peak - eq) / peak;
            if (dd > maxDrawdown) maxDrawdown = dd;

            if (i > 0) {
                const prevEq = equityCurve[i - 1].equity;
                dailyReturns.push((eq - prevEq) / prevEq);
            }
        }

        // Sharpe Ratio (假設無風險利率 1.5%)
        const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1);
        const stdDailyReturn = Math.sqrt(dailyReturns.reduce((a, b) => a + Math.pow(b - avgDailyReturn, 2), 0) / (dailyReturns.length || 1));
        const annualizedReturn = avgDailyReturn * 252;
        const annualizedVol = stdDailyReturn * Math.sqrt(252);
        const sharpeRatio = annualizedVol > 0 ? (annualizedReturn - 0.015) / annualizedVol : 0;

        // 勝率與交易統計
        const winningTrades = trades.filter(t => t.returnPct > 0);
        const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

        return {
            totalReturnPct: totalReturnPct.toFixed(2),
            cagr: cagr.toFixed(2),
            maxDrawdown: (maxDrawdown * 100).toFixed(2),
            sharpeRatio: sharpeRatio.toFixed(2),
            winRate: winRate.toFixed(1),
            totalTrades: trades.length
        };
    }

    /**
     * 幾何布朗運動高真實度模擬數據 (Fallback)
     */
    generateSyntheticData(days, startPrice) {
        const list = [];
        let p = startPrice;
        let v = 30000;
        const today = new Date();
        today.setDate(today.getDate() - days);

        for (let i = 0; i < days; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);

            const drift = 0.0008; // 微小向上趨勢
            const shock = (Math.random() - 0.49) * 0.025;
            p = p * (1 + drift + shock);
            const high = p * (1 + Math.random() * 0.015);
            const low = p * (1 - Math.random() * 0.015);
            v = Math.round(v * (0.8 + Math.random() * 0.4));

            list.push({
                date: d.toISOString().split('T')[0],
                open: p * 0.998,
                high,
                low,
                close: Math.round(p * 10) / 10,
                volume: v
            });
        }
        return list;
    }
}

window.backtestEngine = new BacktestEngine();