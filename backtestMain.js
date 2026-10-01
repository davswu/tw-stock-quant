/**
 * BacktestMain.js - 介面事件綁定與 Chart.js 圖表繪製
 */

let chartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    runBacktest();
});

async function runBacktest() {
    const stockCode = document.getElementById('paramStock').value.trim() || '2330';
    const initialCapital = parseFloat(document.getElementById('paramCapital').value) || 1000000;
    const feeRate = parseFloat(document.getElementById('paramFee').value) || 0.1425;
    const taxRate = parseFloat(document.getElementById('paramTax').value) || 0.3;
    const minScore = parseInt(document.getElementById('paramMinScore').value) || 60;

    const config = { initialCapital, feeRate, taxRate, minScore };

    // 載入與計算數據
    const preparedData = await window.backtestEngine.loadAndPrepareData(stockCode);
    const result = window.backtestEngine.runBacktest(preparedData, config);

    // 1. 渲染 KPI
    renderKPIs(result.kpis);

    // 2. 渲染資產曲線圖表
    renderEquityChart(result.equityCurve, result.bhCurve);

    // 3. 渲染交易明細 Log
    renderTradeLog(result.tradeLogs);
}

function renderKPIs(kpis) {
    document.getElementById('kpiTotalReturn').innerText = `${kpis.totalReturnPct}%`;
    document.getElementById('kpiTotalReturn').className = `text-2xl font-extrabold font-mono ${kpis.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    document.getElementById('kpiCAGR').innerText = `${kpis.cagr}%`;
    document.getElementById('kpiMDD').innerText = `-${kpis.maxDrawdown}%`;
    document.getElementById('kpiSharpe').innerText = kpis.sharpeRatio;
    document.getElementById('kpiWinRate').innerText = `${kpis.winRate}%`;
    document.getElementById('kpiTrades').innerText = `${kpis.totalTrades} 筆`;
}

function renderEquityChart(equityCurve, bhCurve) {
    const ctx = document.getElementById('equityChart').getContext('2d');
    const labels = equityCurve.map(d => d.date);
    const strategyData = equityCurve.map(d => d.equity);
    const bhData = bhCurve.map(d => d.equity);

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '四指標矩陣策略資產',
                    data: strategyData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.1,
                    pointRadius: 0
                },
                {
                    label: '買進持有對照 (Buy & Hold)',
                    data: bhData,
                    borderColor: '#64748b',
                    borderDash: [4, 4],
                    fill: false,
                    tension: 0.1,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#94a3b8' } },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: { ticks: { color: '#64748b', maxTicksLimit: 10 }, grid: { color: '#334155' } },
                y: { ticks: { color: '#64748b' }, grid: { color: '#334155' } }
            }
        }
    });
}

function renderTradeLog(logs) {
    const tbody = document.getElementById('backtestLogBody');
    if (!tbody) return;

    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-slate-500">此設定條件下，歷史時間範圍內無符合進場條件之交易。</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.map(log => `
        <tr class="hover:bg-slate-700/40 border-b border-slate-700/30">
            <td class="p-3 text-slate-300">${log.buyDate}</td>
            <td class="p-3 font-bold text-emerald-400">NT$ ${log.buyPrice.toFixed(1)}</td>
            <td class="p-3"><span class="px-2 py-0.5 text-xs rounded bg-sky-950 text-sky-300 border border-sky-500/30">${log.tier}</span></td>
            <td class="p-3 text-slate-300">${log.sellDate}</td>
            <td class="p-3 font-bold text-rose-400">NT$ ${log.sellPrice.toFixed(1)}</td>
            <td class="p-3 text-xs text-slate-300">${log.exitReason}</td>
            <td class="p-3 font-bold ${log.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${log.returnPct > 0 ? '+' : ''}${log.returnPct}%</td>
            <td class="p-3 text-slate-200">NT$ ${log.accumulatedCapital.toLocaleString()}</td>
        </tr>
    `).join('');
}