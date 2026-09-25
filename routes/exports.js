const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  exportDailyPdf,
  exportMonthlyPdf,
  exportRangePdf,
  exportStatementPdf,
  exportExcel
} = require('../controllers/exportController');

router.get('/pdf/daily', auth, exportDailyPdf);
router.get('/pdf/monthly', auth, exportMonthlyPdf);
router.get('/pdf/range', auth, exportRangePdf);
router.get('/pdf/statement', auth, exportStatementPdf);
router.get('/excel', auth, exportExcel);

module.exports = router;
