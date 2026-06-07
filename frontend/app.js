const API_BASE = window.LOGANALYSER_API_BASE || 'https://loganalyser-backend.onrender.com/api'

// ── DOM refs ──────────────────────────────────────────────────
const typeFilter  = document.getElementById('typeFilter');
const searchInput = document.getElementById('searchInput');
const refreshBtn  = document.getElementById('refreshBtn');
const alertBox    = document.getElementById('alertBox');
const alertText   = document.getElementById('alertText');

// ── File queue (multi-file state) ────────────────────────────
let fileQueue = [];

// ── Tab switcher (Upload / Write) ────────────────────────────
function switchUWTab(tab) {
  document.getElementById('panelUpload').style.display = tab === 'upload' ? '' : 'none';
  document.getElementById('panelWrite').style.display  = tab === 'write'  ? '' : 'none';
  document.getElementById('tabUpload').classList.toggle('active', tab === 'upload');
  document.getElementById('tabWrite').classList.toggle('active',  tab === 'write');
}

// ── File input change (multiple files) ───────────────────────
document.getElementById('fileInput').addEventListener('change', function() {
  addFilesToQueue([...this.files]);
  this.value = ''; // reset so same file can be re-added
});

// ── Drag & Drop ───────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = [...e.dataTransfer.files].filter(f => f.name.match(/\.(log|txt)$/i));
  if (!files.length) { showAlert('Only .log and .txt files are supported'); return; }
  addFilesToQueue(files);
});

// ── Add files to queue ────────────────────────────────────────
function addFilesToQueue(files) {
  files.forEach(file => {
    // avoid duplicates by name
    if (!fileQueue.find(f => f.file.name === file.name)) {
      fileQueue.push({ file, status: 'pending', parsed: 0 });
    }
  });
  renderFileQueue();
}

function renderFileQueue() {
  const el    = document.getElementById('fileQueue');
  const acts  = document.getElementById('uwActions');
  if (!fileQueue.length) { el.style.display = 'none'; acts.style.display = 'none'; return; }
  el.style.display   = 'flex';
  acts.style.display = 'flex';

  el.innerHTML = fileQueue.map((item, i) => {
    const size = item.file.size < 1024
      ? item.file.size + ' B'
      : item.file.size < 1024*1024
        ? (item.file.size/1024).toFixed(1) + ' KB'
        : (item.file.size/1024/1024).toFixed(1) + ' MB';

    const statusText = {
      pending: 'Queued',
      parsing: 'Parsing…',
      done:    `✓ ${item.parsed} logs`,
      error:   '✗ Failed'
    }[item.status];

    return `<div class="fq-item" id="fq-${i}">
      <span class="fq-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
      <span class="fq-name" title="${item.file.name}">${item.file.name}</span>
      <span class="fq-size">${size}</span>
      <span class="fq-status ${item.status}">${statusText}</span>
      ${item.status === 'pending' ? `<button class="fq-remove" onclick="removeFromQueue(${i})"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
    </div>`;
  }).join('');
}

function removeFromQueue(i) {
  fileQueue.splice(i, 1);
  renderFileQueue();
}

function clearFiles() {
  fileQueue = [];
  renderFileQueue();
}

// ── Upload & parse ALL queued files ──────────────────────────
async function uploadFiles() {
  if (!fileQueue.length) return;

  const prog  = document.getElementById('uploadProgress');
  const fill  = document.getElementById('upFill');
  const label = document.getElementById('upLabel');
  prog.style.display = 'block';

  let totalParsed = 0;
  let totalFiles  = fileQueue.length;

  for (let i = 0; i < fileQueue.length; i++) {
    const item = fileQueue[i];
    if (item.status === 'done') continue; // skip already uploaded

    item.status = 'parsing';
    renderFileQueue();
    label.textContent = `Parsing ${item.file.name} (${i+1}/${totalFiles})…`;
    fill.style.width  = Math.round(((i) / totalFiles) * 100) + '%';

    try {
      const text = await item.file.text();
      const logs = text.split(/\r?\n/).filter(l => l.trim()).map(parseLine).filter(Boolean);

      if (!logs.length) {
        item.status = 'error';
        renderFileQueue();
        continue;
      }

      const res  = await fetch(`${API_BASE}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs }),
      });
      const data = await res.json();
      item.status = 'done';
      item.parsed = data.inserted || logs.length;
      totalParsed += item.parsed;
      if (data.alert) showAlert(data.alert);

    } catch(e) {
      item.status = 'error';
    }
    renderFileQueue();
  }

  fill.style.width  = '100%';
  label.textContent = `✓ Done — ${totalParsed} logs uploaded from ${totalFiles} file(s)`;
  setTimeout(() => { prog.style.display = 'none'; fill.style.width = '0'; }, 3000);

  await loadLogs();
}

// ── Manual write & submit ─────────────────────────────────────
async function submitWritten() {
  const raw = document.getElementById('logTextarea').value.trim();
  if (!raw) { showAlert('Please write some log lines first'); return; }

  const logs = raw.split(/\r?\n/).filter(l => l.trim()).map(parseLine).filter(Boolean);
  if (!logs.length) { showAlert('No valid log lines found — check format hints above'); return; }

  try {
    const res  = await fetch(`${API_BASE}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs }),
    });
    const data = await res.json();
    showAlert(`✓ ${data.inserted || logs.length} log entries submitted successfully`, 'success');
    document.getElementById('logTextarea').value = '';
    if (data.alert) setTimeout(() => showAlert(data.alert), 1500);
    await loadLogs();
  } catch(e) {
    // fallback: render locally
    renderLocalLogs(logs);
    showAlert('Backend unreachable — showing parsed logs locally');
  }
}

// ── Insert sample logs into textarea ─────────────────────────
function insertSample() {
  const now = new Date().toISOString().slice(0, 19) + 'Z';
  document.getElementById('logTextarea').value =
`[${now}] INFO - Server started successfully
[${now}] WARNING - Slow query detected (took 2300ms)
[${now}] ERROR - Database connection timeout on host 192.168.1.50
[${now}] ERROR - Payment gateway failed: connection refused
[${now}] INFO - User login successful (id: 1042)
[${now}] WARNING - Memory usage at 87%
[${now}] ERROR - Null pointer exception in AuthService.java:142`;
}

// ── Classify any text as INFO / WARNING / ERROR ──────────────
function classifyLog(text) {
  const u = text.toUpperCase();
  if (/ERROR|ERR\b|FATAL|CRITICAL|EXCEPTION|FAIL|SEVERE/.test(u)) return 'ERROR';
  if (/WARN|WARNING|RETRY|DEPRECATED|NOTICE/.test(u))              return 'WARNING';
  return 'INFO';
}

// ── Multi-format log line parser (matches all 8 C++ formats) ─
function parseLine(line) {
  if (!line || !line.trim()) return null;
  let m;

  // 1) JSON line  {"timestamp":"…","level":"…","message":"…"}
  if (line.trimStart().startsWith('{')) {
    try {
      const j = JSON.parse(line);
      const ts  = j.timestamp || j.time || j.ts || new Date().toISOString();
      const lvl = j.level || j.severity || j.lvl || '';
      const msg = j.message || j.msg || line;
      return { timestamp: ts, type: classifyLog(lvl || msg), message: msg, formatMatched: 'JSON_LINE' };
    } catch (_) {}
  }

  // 2) [timestamp] LEVEL - message
  m = line.match(/^\[(.*?)\]\s+(INFO|WARNING|ERROR|WARN|DEBUG|TRACE|FATAL)\s+-\s+(.+)$/i);
  if (m) return { timestamp: m[1], type: classifyLog(m[2]), message: m[3], formatMatched: 'BRACKET_LEVEL_DASH' };

  // 3) ISO timestamp LEVEL message  (2024-01-15T10:30:00Z ERROR something)
  m = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?)\s+([A-Za-z]+)\s+(.+)$/);
  if (m) return { timestamp: m[1], type: classifyLog(m[2]), message: m[3], formatMatched: 'ISO_LEVEL_MSG' };

  // 4) LEVEL: message
  m = line.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
  if (m && classifyLog(m[1]) !== 'INFO' || (m && /^(INFO|WARN|WARNING|ERROR|DEBUG|FATAL|TRACE)$/i.test(m[1]))) {
    if (m) return { timestamp: new Date().toISOString(), type: classifyLog(m[1]), message: m[2], formatMatched: 'LEVEL_COLON_MSG' };
  }

  // 5) Apache/Nginx  127.0.0.1 - - [date] "GET /path HTTP/1.1" 500 1234
  m = line.match(/^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d{3})\s+/);
  if (m) {
    const code = parseInt(m[4]);
    const type = code >= 500 ? 'ERROR' : code >= 400 ? 'WARNING' : 'INFO';
    return { timestamp: m[2], type, message: `${m[3]} [HTTP ${m[4]}]`, formatMatched: 'APACHE_ACCESS' };
  }

  // 6) Syslog  May  6 10:30:00 hostname proc[pid]: message
  m = line.match(/^([A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+\S+:\s+(.+)$/);
  if (m) return { timestamp: m[1], type: classifyLog(m[2]), message: m[2], formatMatched: 'SYSLOG' };

  // 7) Log4j  2024-01-15 10:30:00,123 ERROR [thread] class - message
  m = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]?\d*)\s+(ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\s+.*?[-–]\s+(.+)$/i);
  if (m) return { timestamp: m[1], type: classifyLog(m[2]), message: m[3], formatMatched: 'LOG4J' };

  // 8) Windows Event  Error   1/15/2024 10:30:00 AM  Application  100  message
  m = line.match(/^(Error|Warning|Information)\s+(\d+\/\d+\/\d{4}\s+\S+\s+[AP]M)\s+\S+\s+\d+\s+(.+)$/i);
  if (m) return { timestamp: m[2], type: classifyLog(m[1]), message: m[3], formatMatched: 'WINDOWS_EVENT' };

  // FALLBACK — classify the whole line
  return { timestamp: new Date().toISOString(), type: classifyLog(line), message: line, formatMatched: 'FALLBACK' };
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
function showAlert(msg, type = 'error') {
  if (!alertBox || !alertText) return;
  alertText.textContent = msg;
  alertBox.className = 'alert-bar show';
  alertBox.style.background = type === 'success'
    ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';
  alertBox.style.borderColor = type === 'success'
    ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
  alertBox.style.color = type === 'success'
    ? 'var(--accent-green)' : 'var(--accent-red)';
  if (type === 'success') setTimeout(hideAlert, 3000);
}
function hideAlert() { if (alertBox) alertBox.classList.remove('show'); }

// ── Event listeners ───────────────────────────────────────────
typeFilter.addEventListener('change', loadLogs);
searchInput.addEventListener('input', () => { clearTimeout(searchInput._t); searchInput._t = setTimeout(loadLogs, 300); });
refreshBtn.addEventListener('click', loadLogs);

// ── Notifications ─────────────────────────────────────────────
let notifications = JSON.parse(localStorage.getItem('ll_notifs') || '[]');

function saveNotifs() { localStorage.setItem('ll_notifs', JSON.stringify(notifications)); }

function addNotif(msg, type = 'error') {
  notifications.unshift({ msg, type, time: new Date().toISOString() });
  if (notifications.length > 20) notifications = notifications.slice(0, 20);
  saveNotifs();
  updateNotifBadge();
}

function updateNotifBadge() {
  const dot = document.getElementById('notifDot');
  if (!dot) return;
  dot.style.display = notifications.length ? 'block' : 'none';
}

function toggleNotifDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('notifDropdown');
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) renderNotifList();
}

function renderNotifList() {
  const el = document.getElementById('notifList');
  if (!el) return;
  if (!notifications.length) {
    el.innerHTML = `<div style="padding:32px 16px;text-align:center;color:var(--text-dim);font-size:13px">No notifications yet</div>`;
    return;
  }
  el.innerHTML = notifications.map((n, i) => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;
      border-bottom:1px solid rgba(255,255,255,.03);font-size:12.5px">
      <div style="width:8px;height:8px;border-radius:50%;margin-top:4px;flex-shrink:0;
        background:${n.type==='error'?'var(--accent-red)':n.type==='warning'?'var(--accent-yellow)':'var(--accent-green)'}"></div>
      <div style="flex:1;min-width:0">
        <div style="color:var(--text-primary);line-height:1.4">${String(n.msg).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>
        <div style="color:var(--text-dim);font-size:11px;margin-top:3px">${new Date(n.time).toLocaleTimeString()}</div>
      </div>
      <span onclick="removeNotif(${i})" style="color:var(--text-dim);cursor:pointer;font-size:16px;flex-shrink:0;line-height:1">×</span>
    </div>`).join('');
}

function removeNotif(i) {
  notifications.splice(i, 1); saveNotifs(); renderNotifList(); updateNotifBadge();
}
function clearNotifs() {
  notifications = []; saveNotifs(); renderNotifList(); updateNotifBadge();
}

document.addEventListener('click', () => {
  const dd = document.getElementById('notifDropdown');
  if (dd) dd.style.display = 'none';
});

// ── Init ──────────────────────────────────────────────────────
// theme.js loads before app.js now, so token is already attached to fetch.
// Run immediately — no need to wait for DOMContentLoaded since scripts are at bottom of body.
buildVolumeChart();
buildDonutChart();
loadLogs();
updateNotifBadge();

// Auto-refresh every 30 seconds
setInterval(loadLogs, 30000);
