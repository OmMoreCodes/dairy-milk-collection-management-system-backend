const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getCollections, createCollection, getCollectionById } = require('../controllers/collectionController');

router.get('/', auth, getCollections);
router.post('/', auth, createCollection);
router.get('/:id', auth, getCollectionById);

module.exports = router;
