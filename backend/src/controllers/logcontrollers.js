const Log = require('../models/logs');

let parseAdvancedQuery;
let detectPatterns;
let buildInsights;

try {
  ({ parseAdvancedQuery, detectPatterns, buildInsights } = require('../services/logAnalysisService'));
} catch (_err) {

  // Fallback to keep backend bootable even if service file is missing in local setup.
  parseAdvancedQuery = (query = '') => {
    const filters = {
      text: [],
      level: null,
      source: null,
      message: null
    };

    (query.match(/(?:[^\s"]+|"[^"]*")+/g) || []).forEach((t) => {

      if (t.startsWith('level:')) {
        filters.level = t
          .slice(6)
          .replace(/"/g, '')
          .toUpperCase();
      }

      else if (t.startsWith('source:')) {
        filters.source = t
          .slice(7)
          .replace(/"/g, '')
          .toLowerCase();
      }

      else if (t.startsWith('message:')) {
        filters.message = t
          .slice(8)
          .replace(/"/g, '')
          .toLowerCase();
      }

      else {
        filters.text.push(
          t.replace(/"/g, '').toLowerCase()
        );
      }
    });

    return filters;
  };

  detectPatterns = (logs = []) => {

    const freq = new Map();

    logs.forEach((l) => {

      const key = (l.message || '')
        .toLowerCase()
        .replace(/\b\d+\b/g, '{n}');

      freq.set(
        key,
        (freq.get(key) || 0) + 1
      );
    });

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({
        pattern,
        count,
        severity: 'ERROR',
        examples: []
      }));
  };

  buildInsights = (logs = []) => {

    const src = new Map();

    logs.forEach((l) => {

      src.set(
        (l.source || 'unknown').toLowerCase(),
        (
          src.get(
            (l.source || 'unknown').toLowerCase()
          ) || 0
        ) + 1
      );
    });

    return {
      topSources: [...src.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),

      topErrors: [],
      anomalies: []
    };
  };
}

const alertRules = [];
const alertHistory = [];

function buildQuery({
  type,
  search,
  start,
  end,
  source
}) {

  const query = {};

  if (type) {
    query.type = type.toUpperCase();
  }

  if (source) {
    query.source = {
      $regex: source,
      $options: 'i'
    };
  }

  if (search) {
    query.message = {
      $regex: search,
      $options: 'i'
    };
  }

  if (start || end) {

    query.timestamp = {};

    if (start) {
      query.timestamp.$gte = start;
    }

    if (end) {
      query.timestamp.$lte = end;
    }
  }

  return query;
}

function evaluateRules(logs) {

  const now = Date.now();

  alertRules.forEach((rule) => {

    const windowStart =
      now - (rule.windowSeconds || 60) * 1000;

    const inWindow = logs.filter(
      (l) =>
        new Date(
          l.createdAt || l.timestamp
        ).getTime() >= windowStart
    );

    let triggered = false;

    if (rule.kind === 'error_count') {

      triggered =
        inWindow.filter(
          (l) =>
            l.type === 'ERROR' ||
            l.type === 'CRITICAL'
        ).length > rule.threshold;
    }

    if (rule.kind === 'source_severity') {

      triggered = inWindow.some(
        (l) =>
          l.source === rule.source &&
          l.type === rule.severity
      );
    }

    if (triggered) {

      alertHistory.unshift({
        id: `${now}-${Math.random()}`,
        ruleName: rule.name,
        triggeredAt: new Date().toISOString(),
        severity: rule.severity || 'ERROR'
      });
    }
  });
}

exports.createLogs = async (req, res) => {

  try {

    const payload = Array.isArray(req.body)
      ? req.body
      : req.body.logs;

    if (
      !Array.isArray(payload) ||
      payload.length === 0
    ) {
      return res.status(400).json({
        error: 'Expected a non-empty logs array'
      });
    }

    const inserted = await Log.insertMany(
      payload,
      { ordered: false }
    );

    evaluateRules(inserted);

    return res.status(201).json({
      inserted: inserted.length
    });

  } catch (err) {

    return res.status(500).json({
      error: err.message
    });
  }
};

exports.getLogs = async (req, res) => {

  try {

    const query = buildQuery(req.query);

    let logs = await Log.find(query)
      .sort({ createdAt: -1 })
      .lean();

    if (req.query.q) {

      const adv = parseAdvancedQuery(
        req.query.q
      );

      logs = logs.filter(
        (l) =>
          (!adv.level ||
            l.type === adv.level) &&

          (!adv.source ||
            (l.source || '')
              .toLowerCase()
              .includes(adv.source)) &&

          (!adv.message ||
            l.message
              .toLowerCase()
              .includes(adv.message)) &&

          adv.text.every((t) =>
            l.message
              .toLowerCase()
              .includes(t)
          )
      );
    }

    const summary = logs.reduce(
      (a, l) => {

        a[l.type] =
          (a[l.type] || 0) + 1;

        return a;
      },
      {
        INFO: 0,
        WARNING: 0,
        ERROR: 0,
        CRITICAL: 0
      }
    );

    return res.json({
      total: logs.length,
      summary,
      logs,
      insights: buildInsights(logs)
    });

  } catch (err) {

    return res.status(500).json({
      error: err.message
    });
  }
};

exports.getPatterns = async (_req, res) => {

  const logs = await Log.find({})
    .sort({ createdAt: -1 })
    .limit(2000)
    .lean();

  res.json({
    patterns: detectPatterns(logs)
  });
};

exports.createRule = (req, res) => {

  const rule = {
    ...req.body,
    id: `rule-${Date.now()}`
  };

  alertRules.push(rule);

  res.status(201).json(rule);
};

exports.getRules = (_req, res) =>
  res.json({
    rules: alertRules
  });

exports.deleteRule = (req, res) => {

  const idx = alertRules.findIndex(
    (r) => r.id === req.params.id
  );

  if (idx >= 0) {
    alertRules.splice(idx, 1);
  }

  res.json({ ok: true });
};

exports.getAlertHistory = (_req, res) =>
  res.json({
    alerts: alertHistory.slice(0, 100)
  });

exports.exportData = async (_req, res) => {

  const logs = await Log.find({})
    .sort({ createdAt: -1 })
    .limit(5000)
    .lean();

  const patterns = detectPatterns(logs);

  const payload = {
    generatedAt: new Date().toISOString(),
    logs,
    patterns,
    alerts: alertHistory
  };

  res.json(payload);
};