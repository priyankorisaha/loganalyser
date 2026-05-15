const express = require('express');

const {
  createLogs,
  getLogs,
  getPatterns,
  createRule,
  getRules,
  deleteRule,
  getAlertHistory,
  exportData,
} = require('../controllers/logcontrollers');

const router = express.Router();

router.post('/logs', createLogs);
router.get('/logs', getLogs);

router.get('/patterns', getPatterns);

router.post('/alert-rules', createRule);
router.get('/alert-rules', getRules);
router.delete('/alert-rules/:id', deleteRule);

router.get('/alerts/history', getAlertHistory);

router.get('/exports', exportData);

module.exports = router;
