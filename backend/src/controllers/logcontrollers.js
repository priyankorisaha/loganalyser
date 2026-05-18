const Log = require('../models/logs');

// ── DSA: Query parser (from logAnalysisService) ──────────────
let parseAdvancedQuery, detectPatterns, buildInsights;
try {
  ({ parseAdvancedQuery, detectPatterns, buildInsights } = require('../services/logAnalysisService'));
} catch (_) {
  parseAdvancedQuery = () => ({ text: [], level: null, source: null, message: null });
  detectPatterns     = () => [];
  buildInsights      = () => ({ topSources: [], topErrors: [], anomalies: [] });
}

// ── In-memory alert rules & history (per-process) ────────────
const alertRules   = [];
const alertHistory = [];

function buildQuery({ type, search, start, end, source }, userId) {
  const query = { userId };   // ← ALWAYS filter by owner
  if (type)   query.type    = type.toUpperCase();
  if (source) query.source  = { $regex: source, $options: 'i' };
  if (search) query.message = { $regex: search, $options: 'i' };
  if (start || end) {
    query.timestamp = {};
    if (start) query.timestamp.$gte = start;
    if (end)   query.timestamp.$lte = end;
  }
  return query;
}

function evaluateRules(logs) {
  const now = Date.now();
  alertRules.forEach(rule => {
    const windowStart = now - (rule.windowSeconds || 60) * 1000;
    const inWindow    = logs.filter(l =>
      new Date(l.createdAt || l.timestamp).getTime() >= windowStart
    );
    let triggered = false;
    if (rule.kind === 'error_count')
      triggered = inWindow.filter(l => l.type === 'ERROR' || l.type === 'CRITICAL').length > rule.threshold;
    if (rule.kind === 'source_severity')
      triggered = inWindow.some(l => l.source === rule.source && l.type === rule.severity);
    if (triggered)
      alertHistory.unshift({
        id: `${now}-${Math.random()}`,
        ruleName:    rule.name,
        triggeredAt: new Date().toISOString(),
        severity:    rule.severity || 'ERROR',
      });
  });
}

// POST /api/logs
exports.createLogs = async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : req.body.logs;
    if (!Array.isArray(payload) || payload.length === 0)
      return res.status(400).json({ error: 'Expected a non-empty logs array' });

    // Attach userId to every log
    const withUser = payload.map(l => ({ ...l, userId: req.userId }));
    const inserted = await Log.insertMany(withUser, { ordered: false });
    evaluateRules(inserted);

    const errorCount = inserted.filter(l => l.type === 'ERROR').length;
    const threshold  = Number(process.env.ALERT_ERROR_THRESHOLD || 10);
    return res.status(201).json({
      inserted: inserted.length,
      alert: errorCount > threshold ? `ALERT: ${errorCount} errors exceed threshold of ${threshold}` : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/logs
exports.getLogs = async (req, res) => {
  try {
    const query = buildQuery(req.query, req.userId);
    let logs = await Log.find(query).sort({ createdAt: -1 }).lean();

    // Advanced query string support
    if (req.query.q) {
      const adv = parseAdvancedQuery(req.query.q);
      logs = logs.filter(l =>
        (!adv.level   || l.type === adv.level) &&
        (!adv.source  || (l.source||'').toLowerCase().includes(adv.source)) &&
        (!adv.message || l.message.toLowerCase().includes(adv.message)) &&
        adv.text.every(t => l.message.toLowerCase().includes(t))
      );
    }

    const summary = logs.reduce(
      (a, l) => { a[l.type] = (a[l.type] || 0) + 1; return a; },
      { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 }
    );

    return res.json({ total: logs.length, summary, logs, insights: buildInsights(logs) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/patterns
exports.getPatterns = async (req, res) => {
  try {
    const logs = await Log.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(2000).lean();
    return res.json({ patterns: detectPatterns(logs) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/exports
exports.exportData = async (req, res) => {
  try {
    const logs     = await Log.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(5000).lean();
    const patterns = detectPatterns(logs);
    return res.json({
      generatedAt: new Date().toISOString(),
      logs, patterns, alerts: alertHistory,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Alert rules (in-memory, shared for simplicity)
exports.createRule    = (req, res) => {
  const rule = { ...req.body, id: `rule-${Date.now()}` };
  alertRules.push(rule);
  res.status(201).json(rule);
};
exports.getRules      = (_req, res) => res.json({ rules: alertRules });
exports.deleteRule    = (req, res) => {
  const idx = alertRules.findIndex(r => r.id === req.params.id);
  if (idx >= 0) alertRules.splice(idx, 1);
  res.json({ ok: true });
};
exports.getAlertHistory = (_req, res) => res.json({ alerts: alertHistory.slice(0, 100) });