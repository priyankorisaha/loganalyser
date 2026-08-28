const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const Log = require('../models/logs');
const User = require('../models/user');
const { sendAlertEmail } = require('../services/emailServices');

// ── DSA: Query parser (from logAnalysisServices) ──────────────
let parseAdvancedQuery, detectPatterns, buildInsights;

try {
  ({
    parseAdvancedQuery,
    detectPatterns,
    buildInsights,
  } = require('../services/logAnalysisServices'));
} catch (_) {
  parseAdvancedQuery = () => ({
    text: [],
    level: null,
    source: null,
    message: null,
  });

  detectPatterns = () => [];

  buildInsights = () => ({
    topSources: [],
    topErrors: [],
    anomalies: [],
  });
}

/**
 * Runs the compiled C++ DSA analysis engine in --analyze-only mode on the given logs.
 * Returns { patterns, insights } on success, or null on any error/timeout.
 */
function runCppAnalysis(logs) {
  return new Promise((resolve) => {
    if (!Array.isArray(logs) || logs.length === 0) {
      return resolve(null);
    }

    const tempFile = path.join(
      os.tmpdir(),
      `logs_${Date.now()}_${Math.random().toString(36).slice(2)}.log`
    );

    try {
      const logLines = logs
        .map((l) =>
          JSON.stringify({
            timestamp: l.timestamp || l.createdAt || new Date().toISOString(),
            level: l.type || 'INFO',
            message: l.message || '',
          })
        )
        .join('\n');

      fs.writeFileSync(tempFile, logLines, 'utf8');
    } catch (err) {
      return resolve(null);
    }

    const binaryPath = process.env.CPP_ENGINE_PATH || '../../cpp-engine/build/log_engine';
    let resolvedPath = path.resolve(__dirname, '..', binaryPath);

    if (process.platform === 'win32' && !resolvedPath.endsWith('.exe')) {
      if (!fs.existsSync(resolvedPath) && fs.existsSync(resolvedPath + '.exe')) {
        resolvedPath += '.exe';
      }
    }

    execFile(
      resolvedPath,
      ['--analyze-only', tempFile],
      { timeout: 5000 },
      (error, stdout, stderr) => {
        try {
          fs.unlinkSync(tempFile);
        } catch (_) {}

        if (error) {
          return resolve(null);
        }

        try {
          const data = JSON.parse(stdout);
          const patterns = (data.topErrors || []).map((e) => {
            const matchingLogs = logs.filter((l) => l.message === e.message);
            const timestamps = matchingLogs
              .map((l) => l.timestamp || l.createdAt)
              .filter(Boolean);
            const type = matchingLogs[0]?.type || 'ERROR';

            return {
              pattern: e.message,
              message: e.message,
              count: e.count,
              severity: type,
              type: type,
              timestamps: timestamps,
            };
          });

          const sourceFreq = new Map();
          logs.forEach((log) => {
            const source = (log.source || 'unknown').toLowerCase();
            sourceFreq.set(source, (sourceFreq.get(source) || 0) + 1);
          });
          const topSources = [...sourceFreq.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

          const insights = {
            topSources,
            topErrors: (data.topErrors || []).map((e) => [e.message, e.count]),
            anomalies: (data.topErrors || [])
              .filter((e) => e.count >= 5)
              .map((e) => ({
                pattern: e.message,
                count: e.count,
              })),
          };

          resolve({ patterns, insights });
        } catch (_) {
          resolve(null);
        }
      }
    );
  });
}

// ── In-memory alert rules & history (per-process) ────────────
const alertRules = [];
const alertHistory = [];

function buildQuery({ type, search, start, end, source }, userId) {
  const query = { userId };

  if (type) {
    query.type = type.toUpperCase();
  }

  if (source) {
    query.source = { $regex: source, $options: 'i' };
  }

  if (search) {
    query.message = { $regex: search, $options: 'i' };
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
    const windowStart = now - (rule.windowSeconds || 60) * 1000;

    const inWindow = logs.filter((l) => {
      return (
        new Date(l.createdAt || l.timestamp).getTime() >= windowStart
      );
    });

    let triggered = false;

    if (rule.kind === 'error_count') {
      triggered =
        inWindow.filter(
          (l) => l.type === 'ERROR' || l.type === 'CRITICAL'
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
        severity: rule.severity || 'ERROR',
      });
    }
  });
}

async function triggerEmailAlerts(insertedLogs, userId) {
  const user = await User.findById(userId)
    .select('emailAlertSettings email')
    .lean();

  const settings = user?.emailAlertSettings;

  // Feature guard
  if (!settings?.enabled) {
    return [];
  }

  const recipient = settings.recipientEmail || user.email;

  if (!recipient) {
    return [];
  }

  const errorCount = insertedLogs.filter((l) =>
    ['ERROR', 'CRITICAL'].includes(l.type)
  ).length;

  const warningCount = insertedLogs.filter(
    (l) => l.type === 'WARNING'
  ).length;

  const anomalies = buildInsights(insertedLogs).anomalies;

  const events = [];

  if (errorCount > (settings.errorThreshold || 10)) {
    events.push({
      alertType: 'Error Threshold Exceeded',
      severity: 'HIGH',
      summary: `${errorCount} error/critical logs exceeded threshold ${
        settings.errorThreshold || 10
      }`,
    });
  }

  if (anomalies.length > 0) {
    events.push({
      alertType: 'Anomaly Detected',
      severity: 'HIGH',
      summary: `${anomalies.length} recurring anomalous error patterns detected in latest batch.`,
    });
  }

  if (warningCount > (settings.warningThreshold || 25)) {
    events.push({
      alertType: 'Warning Spike',
      severity: 'MEDIUM',
      summary: `${warningCount} warnings exceeded threshold ${
        settings.warningThreshold || 25
      }`,
    });
  }

  for (const event of events) {
    await sendAlertEmail({
      to: recipient,
      alertType: event.alertType,
      severity: event.severity,
      timestamp: new Date().toISOString(),
      summary: event.summary,
    });
  }

  return events;
}

// POST /api/logs
exports.createLogs = async (req, res) => {
  try {
    const payload = Array.isArray(req.body)
      ? req.body
      : req.body.logs;

    if (!Array.isArray(payload) || payload.length === 0) {
      return res.status(400).json({
        error: 'Expected a non-empty logs array',
      });
    }

    // Attach userId to every log
    const withUser = payload.map((l) => ({
      ...l,
      userId: req.userId,
    }));

    const inserted = await Log.insertMany(withUser, {
      ordered: false,
    });

    evaluateRules(inserted);

    const emailAlerts = await triggerEmailAlerts(
      inserted,
      req.userId
    );

    const errorCount = inserted.filter(
      (l) => l.type === 'ERROR'
    ).length;

    const threshold = Number(
      process.env.ALERT_ERROR_THRESHOLD || 10
    );

    return res.status(201).json({
      inserted: inserted.length,
      alert:
        errorCount > threshold
          ? `ALERT: ${errorCount} errors exceed threshold of ${threshold}`
          : null,
      emailAlerts,
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
    });
  }
};

// GET /api/logs
exports.getLogs = async (req, res) => {
  try {
    const query = buildQuery(req.query, req.userId);

    let logs = await Log.find(query)
      .sort({ createdAt: -1 })
      .lean();

    // Advanced query string support
    if (req.query.q) {
      const adv = parseAdvancedQuery(req.query.q);

      logs = logs.filter((l) => {
        return (
          (!adv.level || l.type === adv.level) &&
          (!adv.source ||
            (l.source || '')
              .toLowerCase()
              .includes(adv.source)) &&
          (!adv.message ||
            l.message
              .toLowerCase()
              .includes(adv.message)) &&
          adv.text.every((t) =>
            l.message.toLowerCase().includes(t)
          )
        );
      });
    }

    const summary = logs.reduce(
      (a, l) => {
        a[l.type] = (a[l.type] || 0) + 1;
        return a;
      },
      {}
    );

    const cppData = await runCppAnalysis(logs);
    let patterns, insights;
    if (cppData) {
      patterns = cppData.patterns;
      insights = cppData.insights;
    } else {
      patterns = detectPatterns(logs);
      insights = buildInsights(logs);
    }

    return res.json({
      total: logs.length,
      summary,
      logs,
      patterns,
      insights,
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message,
    });
  }
};

exports.getPatterns = async (req, res) => {
  try {
    const query = buildQuery(req.query, req.userId);
    const logs = await Log.find(query).lean();
    
    const cppData = await runCppAnalysis(logs);
    let patterns;
    if (cppData) {
      patterns = cppData.patterns;
    } else {
      patterns = detectPatterns(logs);
    }

    return res.json({
      patterns,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.createRule = async (req, res) => {
  try {
    const rule = req.body;
    if (!rule || !rule.id || !rule.name) {
      return res.status(400).json({ error: 'Invalid rule payload' });
    }

    alertRules.push(rule);
    return res.status(201).json({ rule });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.getRules = async (_req, res) => {
  return res.json({ rules: alertRules });
};

exports.deleteRule = async (req, res) => {
  const id = req.params.id;
  const index = alertRules.findIndex((r) => r.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Rule not found' });
  }

  alertRules.splice(index, 1);
  return res.json({ success: true });
};

exports.getAlertHistory = async (_req, res) => {
  return res.json({ history: alertHistory });
};

exports.exportData = async (req, res) => {
  try {
    const query = buildQuery(req.query, req.userId);
    const logs = await Log.find(query).lean();
    return res.json({ exported: logs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};