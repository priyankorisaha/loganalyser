const express = require('express');
const { createLogs, getLogs } = require('../controllers/logcontrollers');

const router = express.Router();

router.post('/logs', createLogs);
router.get('/logs', getLogs);

module.exports = router;
