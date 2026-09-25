const mongoose = require('mongoose');
const Farmer = require('../models/Farmer');
const MilkCollection = require('../models/MilkCollection');

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function roundTo2(value) {
  return Math.round(value * 100) / 100;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function shiftOrder(shift) {
  return shift === 'Morning' ? 0 : 1;
}

// GET /api/reports/daily?date=
// Summary: total farmers, total liters, avg fat, avg snf, total amount.
// Records: every collection of that date (Morning first).
exports.dailyReport = async (req, res) => {
  try {
    const { date } = req.query;

    if (isBlank(date)) {
      return res.status(400).json({ message: 'Date is required.' });
    }
    if (!isValidDate(date)) {
      return res.status(400).json({ message: 'Date must be a valid date (YYYY-MM-DD).' });
    }

    const collections = await MilkCollection.find({
      organizationId: req.user.organizationId,
      date
    }).populate('farmerId', 'farmerId name village');

    const totalLiters = roundTo2(collections.reduce((sum, c) => sum + c.liters, 0));
    const totalAmount = roundTo2(collections.reduce((sum, c) => sum + c.amount, 0));
    const avgFat = collections.length
      ? roundTo2(collections.reduce((sum, c) => sum + c.fat, 0) / collections.length)
      : 0;
    const avgSnf = collections.length
      ? roundTo2(collections.reduce((sum, c) => sum + c.snf, 0) / collections.length)
      : 0;
    const totalFarmers = new Set(collections.map((c) => String(c.farmerId?._id))).size;

    const records = collections
      .slice()
      .sort((a, b) =>
        shiftOrder(a.shift) - shiftOrder(b.shift) ||
        String(a.farmerId?.farmerId || '').localeCompare(String(b.farmerId?.farmerId || '')) ||
        a.createdAt - b.createdAt
      )
      .map((c) => ({
        _id: c._id,
        date: c.date,
        shift: c.shift,
        milkType: c.milkType,
        liters: c.liters,
        fat: c.fat,
        snf: c.snf,
        rate: c.rate,
        amount: c.amount,
        farmer: {
          _id: c.farmerId?._id,
          farmerId: c.farmerId?.farmerId,
          name: c.farmerId?.name,
          village: c.farmerId?.village
        }
      }));

    return res.status(200).json({
      date,
      summary: {
        totalFarmers,
        totalCollections: collections.length,
        totalLiters,
        avgFat,
        avgSnf,
        totalAmount
      },
      records
    });
  } catch (err) {
    console.error('dailyReport error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /api/reports/monthly?month=&year=
// Summary: farmer-wise totals for the month, plus overall totals.
exports.monthlyReport = async (req, res) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ message: 'Month must be a number between 1 and 12.' });
    }
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      return res.status(400).json({ message: 'Year must be a valid year (1900-2100).' });
    }

    const pad = (n) => String(n).padStart(2, '0');
    const from = `${year}-${pad(month)}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${pad(month)}-${pad(lastDay)}`;

    const collections = await MilkCollection.find({
      organizationId: req.user.organizationId,
      date: { $gte: from, $lte: to }
    }).populate('farmerId', 'farmerId name village');

    const farmersMap = new Map();
    for (const c of collections) {
      const key = String(c.farmerId?._id || 'unknown');
      if (!farmersMap.has(key)) {
        farmersMap.set(key, {
          farmer: {
            _id: c.farmerId?._id,
            farmerId: c.farmerId?.farmerId,
            name: c.farmerId?.name,
            village: c.farmerId?.village
          },
          totalLiters: 0,
          totalAmount: 0,
          collectionCount: 0
        });
      }
      const entry = farmersMap.get(key);
      entry.totalLiters += c.liters;
      entry.totalAmount += c.amount;
      entry.collectionCount += 1;
    }

    const farmers = Array.from(farmersMap.values())
      .map((entry) => ({
        ...entry,
        totalLiters: roundTo2(entry.totalLiters),
        totalAmount: roundTo2(entry.totalAmount)
      }))
      .sort((a, b) => b.totalLiters - a.totalLiters);

    const totalLiters = roundTo2(farmers.reduce((sum, f) => sum + f.totalLiters, 0));
    const totalAmount = roundTo2(farmers.reduce((sum, f) => sum + f.totalAmount, 0));

    return res.status(200).json({
      month,
      year,
      monthName: MONTH_NAMES[month - 1],
      from,
      to,
      summary: {
        farmerCount: farmers.length,
        collectionCount: collections.length,
        totalLiters,
        totalAmount
      },
      farmers
    });
  } catch (err) {
    console.error('monthlyReport error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /api/reports/range?from=&to=
// Summary: total liters and total amount. Records: all collections in range.
exports.rangeReport = async (req, res) => {
  try {
    const { from, to } = req.query;

    if (isBlank(from) || isBlank(to)) {
      return res.status(400).json({ message: 'From date and to date are required.' });
    }
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ message: 'From and to dates must be valid dates (YYYY-MM-DD).' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'From date must be before or equal to the to date.' });
    }

    const collections = await MilkCollection.find({
      organizationId: req.user.organizationId,
      date: { $gte: from, $lte: to }
    }).populate('farmerId', 'farmerId name village');

    const totalLiters = roundTo2(collections.reduce((sum, c) => sum + c.liters, 0));
    const totalAmount = roundTo2(collections.reduce((sum, c) => sum + c.amount, 0));
    const farmerCount = new Set(collections.map((c) => String(c.farmerId?._id))).size;

    const records = collections
      .slice()
      .sort((a, b) =>
        (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
        shiftOrder(a.shift) - shiftOrder(b.shift) ||
        String(a.farmerId?.farmerId || '').localeCompare(String(b.farmerId?.farmerId || ''))
      )
      .map((c) => ({
        _id: c._id,
        date: c.date,
        shift: c.shift,
        milkType: c.milkType,
        liters: c.liters,
        fat: c.fat,
        snf: c.snf,
        rate: c.rate,
        amount: c.amount,
        farmer: {
          _id: c.farmerId?._id,
          farmerId: c.farmerId?.farmerId,
          name: c.farmerId?.name,
          village: c.farmerId?.village
        }
      }));

    return res.status(200).json({
      from,
      to,
      summary: {
        collectionCount: collections.length,
        farmerCount,
        totalLiters,
        totalAmount
      },
      records
    });
  } catch (err) {
    console.error('rangeReport error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /api/reports/statement?farmerId=&from=&to=
// Summary: total liters and total amount for one farmer in a date range.
// Records: per-record rows in chronological order.
exports.statementReport = async (req, res) => {
  try {
    const { farmerId, from, to } = req.query;

    if (isBlank(farmerId) || isBlank(from) || isBlank(to)) {
      return res.status(400).json({ message: 'Farmer, from date and to date are required.' });
    }
    if (!mongoose.isValidObjectId(farmerId)) {
      return res.status(400).json({ message: 'Invalid farmer ID.' });
    }
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ message: 'From and to dates must be valid dates (YYYY-MM-DD).' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'From date must be before or equal to the to date.' });
    }

    const farmer = await Farmer.findOne({
      _id: farmerId,
      organizationId: req.user.organizationId
    });
    if (!farmer) {
      return res.status(404).json({ message: 'Farmer not found.' });
    }

    const collections = await MilkCollection.find({
      organizationId: req.user.organizationId,
      farmerId: farmer._id,
      date: { $gte: from, $lte: to }
    }).sort({ date: 1, createdAt: 1 });

    const totalLiters = roundTo2(collections.reduce((sum, c) => sum + c.liters, 0));
    const totalAmount = roundTo2(collections.reduce((sum, c) => sum + c.amount, 0));

    return res.status(200).json({
      farmer: {
        _id: farmer._id,
        farmerId: farmer.farmerId,
        name: farmer.name,
        phone: farmer.phone,
        village: farmer.village,
        address: farmer.address,
        status: farmer.status
      },
      from,
      to,
      summary: {
        collectionCount: collections.length,
        totalLiters,
        totalAmount
      },
      records: collections.map((c) => ({
        _id: c._id,
        date: c.date,
        shift: c.shift,
        milkType: c.milkType,
        liters: c.liters,
        fat: c.fat,
        snf: c.snf,
        rate: c.rate,
        amount: c.amount
      }))
    });
  } catch (err) {
    console.error('statementReport error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};
