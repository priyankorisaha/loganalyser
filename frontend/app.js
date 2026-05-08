const API_BASE = 'http://localhost:5000/api';

// ── DOM refs ──────────────────────────────────────────────────
const fileInput   = document.getElementById('fileInput');
const uploadBtn   = document.getElementById('uploadBtn');
const typeFilter  = document.getElementById('typeFilter');
const searchInput = document.getElementById('searchInput');
const refreshBtn  = document.getElementById('refreshBtn');
const alertBox    = document.getElementById('alertBox');
const alertText   = document.getElementById('alertText');

// ── Upload trigger on file select ────────────────────────────
fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadLogFile(); });

// ── Parse a log line ─────────────────────────────────────────
function parseLine(line) {
  const match = line.match(/^\[(.*?)\]\s+(INFO|WARNING|ERROR)\s+-\s+(.*)$/);
  if (!match) return null;
  return { timestamp: match[1], type: match[2], message: match[3] };
}

// ── Upload & parse ───────────────────────────────────────────
async function uploadLogFile() {
  const file = fileInput.files[0];
  if (!file) return;

  const text = await file.text();
  const logs = text.split(/\r?\n/).map(parseLine).filter(Boolean);
  if (!logs.length) { showAlert('No valid log lines found in this file.'); return; }

  try {
    const response = await fetch(`${API_BASE}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs }),
    });
    const data = await response.json();
    if (data.alert) showAlert(data.alert);
    else hideAlert();
  } catch (e) {
    console.warn('Backend unavailable — rendering local parse only.');
    renderLocalLogs(logs);
    return;
  }
  await loadLogs();
}

// ── Render without backend ───────────────────────────────────
function renderLocalLogs(logs) {
  const summary = { ERROR: 0, WARNING: 0, INFO: 0 };
  logs.forEach(l => { if (summary[l.type] !== undefined) summary[l.type]++; });
  updateStats({ total: logs.length, summary });
  renderTable(logs);
  updateCharts(summary);
}

// ── Load logs from backend ───────────────────────────────────
async function loadLogs() {
  const params = new URLSearchParams();
  if (typeFilter.value)            params.set('type', typeFilter.value);
  if (searchInput.value.trim())    params.set('search', searchInput.value.trim());

  try {
    const response = await fetch(`${API_BASE}/logs?${params.toString()}`);
    const data = await response.json();
    updateStats(data);
    renderTable(data.logs);
    updateCharts(data.summary);
  } catch (e) {
    console.warn('Backend not reachable.');
  }
}

// ── Update stat cards ─────────────────────────────────────────
function updateStats({ total, summary }) {
  const t = total ?? 0;
  const e = summary?.ERROR   ?? 0;
  const w = summary?.WARNING ?? 0;
  const i = summary?.INFO    ?? 0;

  document.getElementById('totalCount').textContent   = fmtNum(t);
  document.getElementById('infoCount').textContent    = fmtNum(i);
  document.getElementById('errorCount').textContent   = fmtNum(e);
  document.getElementById('warningCount').textContent = fmtNum(w);
  document.getElementById('activeCount').textContent  = fmtNum(e + w);
  document.getElementById('critCount').textContent    = fmtNum(e);
  document.getElementById('paginationInfo').textContent = `1–${Math.min(50, t)} of ${fmtNum(t)}`;

  const rate = t > 0 ? ((e / t) * 100).toFixed(2) + '%' : '0.00%';
  document.getElementById('errorRateVal').textContent = rate;
}

// ── Render table rows ─────────────────────────────────────────
function renderTable(logs) {
  const tbody = document.getElementById('logTableBody');
  if (!logs || !logs.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text-dim);font-size:13px;">No log entries match the current filters</td></tr>`;
    return;
  }

  // Infer a fake "source" from message if not present
  const sources = ['Web Server', 'App A', 'DB Server', 'Network', 'Firewall'];

  tbody.innerHTML = logs.map((l, idx) => {
    const src = l.source || sources[idx % sources.length];
    const lvlClass = l.type === 'ERROR' ? 'level-error' : l.type === 'WARNING' ? 'level-warning' : 'level-info';
    return `<tr>
      <td class="ts">${escHtml(l.timestamp)}</td>
      <td><span class="level-badge ${lvlClass}"><span class="dot"></span>${l.type}</span></td>
      <td style="color:var(--text-secondary);font-size:12px">${escHtml(src)}</td>
      <td class="msg" title="${escHtml(l.message)}">${escHtml(l.message)}</td>
    </tr>`;
  }).join('');
}

// ── Charts ────────────────────────────────────────────────────
let volumeChart = null;
let donutChart  = null;

function buildVolumeChart() {
  const ctx = document.getElementById('volumeChart').getContext('2d');
  const hours = [];
  for (let h = 0; h < 24; h++) hours.push(`${String(h).padStart(2,'0')}:00`);

  const totalData  = hours.map(() => Math.floor(Math.random() * 300000 + 100000));
  const errorData  = hours.map((_, i) => Math.floor(totalData[i] * (Math.random() * 0.05)));

  volumeChart = new Chart(ctx, {
    data: {
      labels: hours,
      datasets: [
        {
          type: 'line',
          label: 'Total Logs',
          data: totalData,
          borderColor: '#4f8ef7',
          backgroundColor: 'rgba(79,142,247,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: true,
          yAxisID: 'y',
        },
        {
          type: 'bar',
          label: 'Errors',
          data: errorData,
          backgroundColor: 'rgba(239,68,68,0.55)',
          borderRadius: 2,
          yAxisID: 'y1',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,16,28,0.92)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#7a8aa0',
          bodyColor: '#e8edf5',
          titleFont: { family: "'Space Mono', monospace", size: 10 },
          bodyFont: { family: "'DM Sans', sans-serif", size: 12 },
          padding: 12,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtNum(ctx.raw)}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: { color: '#4a5568', font: { size: 10 }, maxTicksLimit: 8 },
          border: { display: false },
        },
        y: {
          position: 'left',
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#4a5568', font: { size: 10 }, callback: v => fmtNum(v) },
          border: { display: false },
        },
        y1: {
          position: 'right',
          grid: { display: false },
          ticks: { display: false },
          border: { display: false },
        }
      }
    }
  });
}

function buildDonutChart() {
  const ctx = document.getElementById('donutChart').getContext('2d');
  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Application A', 'Web Server', 'DB Server', 'Network', 'Firewall'],
      datasets: [{
        data: [35, 28, 18, 12, 7],
        backgroundColor: ['#4f8ef7','#22c55e','#a78bfa','#f59e0b','#ef4444'],
        borderColor: 'rgba(8,12,20,0)',
        borderWidth: 3,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,16,28,0.92)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#7a8aa0',
          bodyColor: '#e8edf5',
          titleFont: { family: "'Space Mono', monospace", size: 10 },
          bodyFont: { family: "'DM Sans', sans-serif", size: 12 },
          padding: 10,
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}%` }
        }
      }
    }
  });
}

function updateCharts(summary) {
  if (!volumeChart || !summary) return;
  // Distribute summary counts across hours for visual effect
  const e = summary.ERROR || 0, w = summary.WARNING || 0, i = summary.INFO || 0;
  const total = e + w + i;
  if (!total) return;

  const hours = 24;
  const newTotal  = Array.from({ length: hours }, () => Math.floor(total / hours * (0.6 + Math.random() * 0.8)));
  const newErrors = Array.from({ length: hours }, (_, idx) => Math.floor(newTotal[idx] * (e / Math.max(total, 1)) * (0.5 + Math.random())));

  volumeChart.data.datasets[0].data = newTotal;
  volumeChart.data.datasets[1].data = newErrors;
  volumeChart.update('active');

  // Update donut proportionally
  if (total > 0 && donutChart) {
    const appA = Math.round((i / total) * 60);
    const web  = Math.round((w / total) * 60 + 15);
    const db   = Math.round((e / total) * 40 + 10);
    const net  = Math.max(5, 100 - appA - web - db - 5);
    donutChart.data.datasets[0].data = [appA, web, db, net, 5];
    donutChart.update('active');
  }
}

// ── Helpers ───────────────────────────────────────────────────
function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showAlert(msg) {
  alertText.textContent = msg;
  alertBox.classList.add('show');
}
function hideAlert() { alertBox.classList.remove('show'); }

// ── Event listeners ───────────────────────────────────────────
typeFilter.addEventListener('change', loadLogs);
searchInput.addEventListener('input', () => { clearTimeout(searchInput._t); searchInput._t = setTimeout(loadLogs, 300); });
refreshBtn.addEventListener('click', loadLogs);

// ── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  buildVolumeChart();
  buildDonutChart();
  loadLogs();
});