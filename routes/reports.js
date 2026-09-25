const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  dailyReport,
  monthlyReport,
  rangeReport,
  statementReport
} = require('../controllers/reportController');

router.get('/daily', auth, dailyReport);
router.get('/monthly', auth, monthlyReport);
router.get('/range', auth, rangeReport);
router.get('/statement', auth, statementReport);

module.exports = router;
