const express  = require('express');
const auth     = require('../middleware/auth');
const { register, login, me } = require('../controllers/authcontroller');
const {
  createLogs, getLogs, getPatterns,
  createRule, getRules, deleteRule,
  getAlertHistory, exportData,
} = require('../controllers/logcontrollers');

const router = express.Router();

// ── Public: no token needed ──────────────────
router.post('/auth/register', register);
router.post('/auth/login',    login);
router.get ('/auth/me',       auth, me);

// ── Protected: JWT required ──────────────────
router.post('/logs',                auth, createLogs);
router.get ('/logs',                auth, getLogs);
router.get ('/patterns',            auth, getPatterns);
router.get ('/exports',             auth, exportData);

router.post  ('/alert-rules',       auth, createRule);
router.get   ('/alert-rules',       auth, getRules);
router.delete('/alert-rules/:id',   auth, deleteRule);
router.get   ('/alerts/history',    auth, getAlertHistory);

module.exports = router;