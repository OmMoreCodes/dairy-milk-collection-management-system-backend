const mongoose = require('mongoose');
const Farmer = require('../models/Farmer');
const Rate = require('../models/Rate');
const MilkCollection = require('../models/MilkCollection');

const SHIFTS = ['Morning', 'Evening'];
const MILK_TYPES = ['Cow', 'Buffalo'];

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Finds the rate that applies to a new collection entry: the newest Rate
// document of this organization whose effectiveFrom is on or before the
// collection date. If none applies yet (for example the first rate ever),
// the newest rate for that milk type is used. The value returned here is
// frozen onto the MilkCollection record and never recalculated again.
async function resolveRate(organizationId, milkType, date) {
  let rateDoc = await Rate.findOne({
    organizationId,
    milkType,
    effectiveFrom: { $lte: date }
  }).sort({ effectiveFrom: -1, createdAt: -1 });

  if (!rateDoc) {
    rateDoc = await Rate.findOne({ organizationId, milkType }).sort({
      effectiveFrom: -1,
      createdAt: -1
    });
  }

  return rateDoc;
}

// GET /api/collections
// Collection history with optional filters:
//   farmerId, date, from, to, shift, milkType
exports.getCollections = async (req, res) => {
  try {
    const { farmerId, date, from, to, shift, milkType } = req.query;
    const query = { organizationId: req.user.organizationId };

    if (!isBlank(farmerId)) {
      if (!mongoose.isValidObjectId(farmerId)) {
        return res.status(400).json({ message: 'Invalid farmer ID filter.' });
      }
      query.farmerId = farmerId;
    }
    if (!isBlank(date)) {
      if (!isValidDate(date)) {
        return res.status(400).json({ message: 'Date filter must be a valid date (YYYY-MM-DD).' });
      }
      query.date = date;
    }
    if (!isBlank(from)) {
      if (!isValidDate(from)) {
        return res.status(400).json({ message: 'From date must be a valid date (YYYY-MM-DD).' });
      }
      query.date = query.date || {};
      query.date.$gte = from;
    }
    if (!isBlank(to)) {
      if (!isValidDate(to)) {
        return res.status(400).json({ message: 'To date must be a valid date (YYYY-MM-DD).' });
      }
      query.date = query.date || {};
      query.date.$lte = to;
    }
    if (query.date && Object.keys(query.date).length === 0) delete query.date;
    if (!isBlank(shift)) {
      if (!SHIFTS.includes(shift)) {
        return res.status(400).json({ message: 'Shift must be either Morning or Evening.' });
      }
      query.shift = shift;
    }
    if (!isBlank(milkType)) {
      if (!MILK_TYPES.includes(milkType)) {
        return res.status(400).json({ message: 'Milk type must be either Cow or Buffalo.' });
      }
      query.milkType = milkType;
    }

    if (!isBlank(from) && !isBlank(to) && from > to) {
      return res.status(400).json({ message: 'From date must be before or equal to the to date.' });
    }

    const collections = await MilkCollection.find(query)
      .populate('farmerId', 'farmerId name village phone status')
      .sort({ date: -1, createdAt: -1 });

    return res.status(200).json(collections);
  } catch (err) {
    console.error('getCollections error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// POST /api/collections
// Records one milk collection. The `rate` is copied from the current Rate
// document and `amount` is ALWAYS calculated on the server as liters x rate.
// Any rate or amount sent by the client is ignored.
exports.createCollection = async (req, res) => {
  try {
    const { farmerId, date, shift, milkType, liters, fat, snf } = req.body || {};

    if (isBlank(farmerId) || isBlank(date) || isBlank(shift) || isBlank(milkType) ||
        liters === undefined || fat === undefined || snf === undefined) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    if (!mongoose.isValidObjectId(farmerId)) {
      return res.status(400).json({ message: 'Invalid farmer ID.' });
    }
    if (!isValidDate(date)) {
      return res.status(400).json({ message: 'Date must be a valid date (YYYY-MM-DD).' });
    }
    if (!SHIFTS.includes(shift)) {
      return res.status(400).json({ message: 'Shift must be either Morning or Evening.' });
    }
    if (!MILK_TYPES.includes(milkType)) {
      return res.status(400).json({ message: 'Milk type must be either Cow or Buffalo.' });
    }

    const litersValue = Number(liters);
    const fatValue = Number(fat);
    const snfValue = Number(snf);

    if (!Number.isFinite(litersValue) || litersValue <= 0) {
      return res.status(400).json({ message: 'Liters must be a number greater than 0.' });
    }
    if (!Number.isFinite(fatValue) || fatValue < 0 || fatValue > 100) {
      return res.status(400).json({ message: 'Fat must be a number between 0 and 100.' });
    }
    if (!Number.isFinite(snfValue) || snfValue < 0 || snfValue > 100) {
      return res.status(400).json({ message: 'SNF must be a number between 0 and 100.' });
    }

    const farmer = await Farmer.findOne({
      _id: farmerId,
      organizationId: req.user.organizationId
    });
    if (!farmer) {
      return res.status(404).json({ message: 'Farmer not found.' });
    }
    if (farmer.status !== 'active') {
      return res.status(400).json({ message: 'This farmer is inactive. Only active farmers can record milk collections.' });
    }

    const rateDoc = await resolveRate(req.user.organizationId, milkType, date);
    if (!rateDoc) {
      return res.status(400).json({
        message: `No milk rate found for ${milkType} milk. Please add a rate in the Rates page first.`
      });
    }

    const amount = Math.round(litersValue * rateDoc.rate * 100) / 100;

    const collection = await MilkCollection.create({
      organizationId: req.user.organizationId,
      farmerId: farmer._id,
      date,
      shift,
      milkType,
      liters: litersValue,
      fat: fatValue,
      snf: snfValue,
      rate: rateDoc.rate,
      amount
    });

    await collection.populate('farmerId', 'farmerId name village');

    return res.status(201).json({
      message: 'Milk collection recorded successfully.',
      collection
    });
  } catch (err) {
    console.error('createCollection error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /api/collections/:id
exports.getCollectionById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid collection ID.' });
    }

    const collection = await MilkCollection.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId
    }).populate('farmerId', 'farmerId name village phone status');

    if (!collection) {
      return res.status(404).json({ message: 'Milk collection not found.' });
    }

    return res.status(200).json(collection);
  } catch (err) {
    console.error('getCollectionById error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};
