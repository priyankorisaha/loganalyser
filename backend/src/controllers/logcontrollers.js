const Log = require('../models/logs');

function buildQuery({ type, search, start, end }) {
  const query = {};
  if (type) query.type = type.toUpperCase();
  if (search) query.message = { $regex: search, $options: 'i' };
  if (start || end) {
    query.timestamp = {};
    if (start) query.timestamp.$gte = start;
    if (end) query.timestamp.$lte = end;
  }
  return query;
}

exports.createLogs = async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : req.body.logs;
    if (!Array.isArray(payload) || payload.length === 0) {
      return res.status(400).json({ error: 'Expected a non-empty logs array' });
    }

    const inserted = await Log.insertMany(payload, { ordered: false });
    const errorCount = inserted.filter((l) => l.type === 'ERROR').length;
    const threshold = Number(process.env.ALERT_ERROR_THRESHOLD || 10);

    return res.status(201).json({
      inserted: inserted.length,
      alert: errorCount > threshold ? `ALERT: ERROR count ${errorCount} > ${threshold}` : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.getLogs = async (req, res) => {
  try {
    const query = buildQuery(req.query);
    const logs = await Log.find(query).sort({ createdAt: -1 }).lean();
    const summary = logs.reduce(
      (acc, log) => {
        acc[log.type] += 1;
        return acc;
      },
      { INFO: 0, WARNING: 0, ERROR: 0 }
    );

    return res.json({ total: logs.length, summary, logs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
