const AIAnalysis = require('../models/aiAnalysis');
const AIReport = require('../models/aiReport');
const { analyzeOne } = require('../services/aiAnalysisServices');

exports.analyze = async (req, res) => {
  try {
    if (!req.body?.log) return res.status(400).json({ error: 'log is required' });
    const result = await analyzeOne({ log: req.body.log, userId: req.userId, force: Boolean(req.body.force) });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.analyzeBulk = async (req, res) => {
  try {
    const logs = req.body?.logs;
    if (!Array.isArray(logs) || !logs.length) return res.status(400).json({ error: 'logs array is required' });
    const results = await Promise.all(logs.map((log) => analyzeOne({ log, userId: req.userId })));
    res.json({ count: results.length, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.history = async (req, res) => {
  const items = await AIAnalysis.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(items);
};

exports.byId = async (req, res) => {
  const item = await AIAnalysis.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
};

exports.generateReport = async (req, res) => {
  const logs = req.body?.logs || [];
  const results = await Promise.all(logs.map((log) => analyzeOne({ log, userId: req.userId })));
  const critical = results.filter((r) => ['HIGH', 'CRITICAL'].includes((r.severity || '').toUpperCase()));
  const report = {
    summary: `Analyzed ${results.length} logs. Critical incidents: ${critical.length}.`,
    recurringProblems: [...new Set(results.map((r) => r.cleanedLog))].slice(0, 5),
    criticalIncidents: critical.slice(0, 10).map((r) => r.aiResponse.title),
    suggestedImprovements: ['Add runbook links', 'Increase alert precision', 'Track MTTR per incident type'],
  };
  const saved = await AIReport.create({ userId: req.userId, title: 'AI Generated Log Report', report });
  res.json(saved);
};
