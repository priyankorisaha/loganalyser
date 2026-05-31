const { cleanLogMessage } = require('../utils/logCleaning');

function logPreprocessingMiddleware(req, _res, next) {
  const body = req.body || {};
  if (body.log) {
    req.cleanedLog = cleanLogMessage(body.log);
  }
  if (Array.isArray(body.logs)) {
    req.cleanedLogs = body.logs.map((l) => cleanLogMessage(typeof l === 'string' ? l : l.message || ''));
  }
  next();
}

module.exports = logPreprocessingMiddleware;
