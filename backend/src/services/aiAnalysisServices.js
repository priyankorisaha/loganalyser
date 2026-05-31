const crypto = require('crypto');
const AIAnalysis = require('../models/aiAnalysis');
const { cleanLogMessage } = require('../utils/logCleaning');

const cache = new Map();

function hashLog(cleanedLog) {
  return crypto.createHash('sha256').update(cleanedLog).digest('hex');
}

async function callOpenAI(cleanedLog) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const prompt = `Analyze this log signature and respond ONLY valid JSON with keys title,problem,rootCause,severity,fixes,prevention,summary. Log: ${cleanedLog}`;
  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    temperature: 0.1,
    messages: [
      { role: 'system', content: 'You are a senior SRE. Be concise, technical, avoid speculation.' },
      { role: 'user', content: prompt },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  const data = await resp.json();
  if (!resp.ok) {
    const errorMessage = data?.error?.message || JSON.stringify(data);
    throw new Error(`OpenAI API error: ${resp.status} ${errorMessage}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response content from OpenAI');

  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse OpenAI JSON response: ${err.message}`);
  }
}

async function analyzeOne({ log, userId, force = false }) {
  const cleanedLog = cleanLogMessage(log);
  const logHash = hashLog(cleanedLog);

  if (!force && cache.has(logHash)) return cache.get(logHash);
  if (!force) {
    const existing = await AIAnalysis.findOne({ logHash }).lean();
    if (existing) {
      cache.set(logHash, existing);
      return existing;
    }
  }

  let aiResponse;
  try {
    aiResponse = await callOpenAI(cleanedLog);
  } catch (e) {
    aiResponse = {
      title: 'Analysis unavailable',
      problem: cleanedLog,
      rootCause: `AI call failed: ${e.message}`,
      severity: 'MEDIUM',
      fixes: ['Verify OPENAI_API_KEY, OPENAI_MODEL, and outbound internet from backend.'],
      prevention: ['Add backend logging/alerts for OpenAI API failures.'],
      summary: 'Fallback response generated due to AI failure.',
    };
  }

  const doc = await AIAnalysis.findOneAndUpdate(
    { logHash },
    {
      userId,
      originalLog: log,
      cleanedLog,
      logHash,
      aiResponse,
      severity: aiResponse.severity || 'UNKNOWN',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  cache.set(logHash, doc);
  return doc;
}

module.exports = { analyzeOne, hashLog };
