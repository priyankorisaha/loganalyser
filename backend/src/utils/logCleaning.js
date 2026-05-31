const PATTERNS = {
  timestamp: /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
  bracketThread: /\[[^\]]+\]/g,
  ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  sessionToken: /\b(?:session|token|auth|jwt|sid)[=:]\S+\b/gi,
  randomId: /\b(?:id|reqId|requestId|traceId|spanId|user|uid)[=:]\w+\b/gi,
  uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  metadata: /\b(?:host|service|env|region|node|thread|pid)[=:]\S+\b/gi,
  multiSpace: /\s+/g,
};

function cleanLogMessage(input = '') {
  let text = String(input);
  text = text.replace(PATTERNS.timestamp, ' ')
    .replace(PATTERNS.bracketThread, ' ')
    .replace(PATTERNS.ipAddress, ' ')
    .replace(PATTERNS.sessionToken, ' ')
    .replace(PATTERNS.randomId, ' ')
    .replace(PATTERNS.uuid, ' ')
    .replace(PATTERNS.metadata, ' ')
    .replace(/\b\w{1,3}-\d+\b/g, ' ')
    .replace(PATTERNS.multiSpace, ' ')
    .trim();

  const strongToken = text.match(/\b[A-Z_]{3,}\b/g);
  if (strongToken && strongToken.length) return strongToken[0];

  return text || 'UNKNOWN_ERROR';
}

module.exports = { PATTERNS, cleanLogMessage };
