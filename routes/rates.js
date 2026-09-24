const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getRates, createRate, updateRate } = require('../controllers/rateController');

router.get('/', auth, getRates);
router.post('/', auth, createRate);
router.put('/:id', auth, updateRate);

module.exports = router;
