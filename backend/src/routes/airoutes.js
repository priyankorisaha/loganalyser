const express = require('express');
const auth = require('../middleware/auth');
const logPreprocessingMiddleware = require('../middleware/logPreprocessingMiddleware');
const c = require('../controllers/aiAnalysisController');

const router = express.Router();
router.post('/analyze', auth, logPreprocessingMiddleware, c.analyze);
router.post('/analyze-bulk', auth, logPreprocessingMiddleware, c.analyzeBulk);
router.get('/history', auth, c.history);
router.get('/:id', auth, c.byId);
router.post('/report', auth, c.generateReport);

module.exports = router;
