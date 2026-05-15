const tokenize = (value = '') => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s:_"-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
};

const parseTimeToken = (token) => {
  const d = new Date();

  const m = token.match(/(\d{1,2})(?::(\d{2}))?(am|pm)?/i);

  if (!m) {
    return null;
  }

  let h = +m[1];
  const min = +(m[2] || 0);
  const ap = (m[3] || '').toLowerCase();

  if (ap === 'pm' && h < 12) {
    h += 12;
  }

  if (ap === 'am' && h === 12) {
    h = 0;
  }

  d.setHours(h, min, 0, 0);

  return d;
};

function parseAdvancedQuery(query = '') {
  const filters = {
    text: [],
    level: null,
    source: null,
    message: null,
    after: null,
    before: null,
  };

  const tokens =
    query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

  tokens.forEach((token) => {
    if (token.startsWith('level:')) {
      filters.level = token
        .slice(6)
        .replace(/"/g, '')
        .toUpperCase();
    }

    else if (token.startsWith('source:')) {
      filters.source = token
        .slice(7)
        .replace(/"/g, '')
        .toLowerCase();
    }

    else if (token.startsWith('message:')) {
      filters.message = token
        .slice(8)
        .replace(/"/g, '')
        .toLowerCase();
    }

    else if (token.startsWith('after:')) {
      filters.after = parseTimeToken(
        token.slice(6)
      );
    }

    else if (token.startsWith('before:')) {
      filters.before = parseTimeToken(
        token.slice(7)
      );
    }

    else {
      filters.text.push(
        token.replace(/"/g, '').toLowerCase()
      );
    }
  });

  return filters;
}

const normalizePattern = (message = '') => {
  return message
    .toLowerCase()
    .replace(/\b\d+\b/g, '{n}')
    .replace(/[a-f0-9]{8,}/g, '{id}')
    .replace(/\s+/g, ' ')
    .trim();
};

function detectPatterns(logs = []) {
  const map = new Map();

  logs.forEach((log) => {
    const key = normalizePattern(log.message);

    if (!map.has(key)) {
      map.set(key, {
        pattern: key,
        count: 0,
        severity: log.type,
        examples: [],
      });
    }

    const current = map.get(key);

    current.count++;

    if (current.examples.length < 3) {
      current.examples.push(log.message);
    }
  });

  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function buildInsights(logs = []) {
  const sourceFreq = new Map();
  const errorFreq = new Map();

  logs.forEach((log) => {
    const source = (
      log.source || 'unknown'
    ).toLowerCase();

    sourceFreq.set(
      source,
      (sourceFreq.get(source) || 0) + 1
    );

    if (log.type === 'ERROR') {
      const key = normalizePattern(log.message);

      errorFreq.set(
        key,
        (errorFreq.get(key) || 0) + 1
      );
    }
  });

  return {
    topSources: [...sourceFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),

    topErrors: [...errorFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),

    anomalies: [...errorFreq.entries()]
      .filter(([, count]) => count >= 5)
      .map(([pattern, count]) => ({
        pattern,
        count,
      })),
  };
}

module.exports = {
  tokenize,
  parseAdvancedQuery,
  detectPatterns,
  buildInsights,
};