const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getFarmers,
  createFarmer,
  getFarmerById,
  updateFarmer,
  deleteFarmer
} = require('../controllers/farmerController');

router.get('/', auth, getFarmers);
router.post('/', auth, createFarmer);
router.get('/:id', auth, getFarmerById);
router.put('/:id', auth, updateFarmer);
router.delete('/:id', auth, deleteFarmer);

module.exports = router;
