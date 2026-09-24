const mongoose = require('mongoose');
const Rate = require('../models/Rate');

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

// GET /api/rates
// Lists all rates of the caller's organization, newest effectiveFrom first.
exports.getRates = async (req, res) => {
  try {
    const rates = await Rate.find({ organizationId: req.user.organizationId })
      .sort({ effectiveFrom: -1, createdAt: -1 });
    return res.status(200).json(rates);
  } catch (err) {
    console.error('getRates error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// POST /api/rates
// Adds a new rate for a milk type. Existing rates are kept as history so
// past collections keep their frozen rate.
exports.createRate = async (req, res) => {
  try {
    const { milkType, rate, effectiveFrom } = req.body || {};

    if (isBlank(milkType) || isBlank(rate) || isBlank(effectiveFrom)) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    if (!MILK_TYPES.includes(milkType)) {
      return res.status(400).json({ message: 'Milk type must be either Cow or Buffalo.' });
    }
    const rateValue = Number(rate);
    if (!Number.isFinite(rateValue) || rateValue <= 0) {
      return res.status(400).json({ message: 'Rate must be a number greater than 0.' });
    }
    if (!isValidDate(effectiveFrom)) {
      return res.status(400).json({ message: 'Effective from must be a valid date (YYYY-MM-DD).' });
    }

    const created = await Rate.create({
      organizationId: req.user.organizationId,
      milkType,
      rate: rateValue,
      effectiveFrom
    });

    return res.status(201).json({
      message: `${milkType} milk rate saved successfully.`,
      rate: created
    });
  } catch (err) {
    console.error('createRate error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// PUT /api/rates/:id
// Corrects an existing rate entry.
exports.updateRate = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid rate ID.' });
    }

    const existing = await Rate.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId
    });

    if (!existing) {
      return res.status(404).json({ message: 'Rate not found.' });
    }

    const { milkType, rate, effectiveFrom } = req.body || {};
    const updates = {};

    if (milkType !== undefined) {
      if (!MILK_TYPES.includes(milkType)) {
        return res.status(400).json({ message: 'Milk type must be either Cow or Buffalo.' });
      }
      updates.milkType = milkType;
    }
    if (rate !== undefined) {
      const rateValue = Number(rate);
      if (!Number.isFinite(rateValue) || rateValue <= 0) {
        return res.status(400).json({ message: 'Rate must be a number greater than 0.' });
      }
      updates.rate = rateValue;
    }
    if (effectiveFrom !== undefined) {
      if (!isValidDate(effectiveFrom)) {
        return res.status(400).json({ message: 'Effective from must be a valid date (YYYY-MM-DD).' });
      }
      updates.effectiveFrom = effectiveFrom;
    }

    const updated = await Rate.findByIdAndUpdate(existing._id, { $set: updates }, {
      new: true,
      runValidators: true
    });

    return res.status(200).json({
      message: 'Rate updated successfully.',
      rate: updated
    });
  } catch (err) {
    console.error('updateRate error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};
