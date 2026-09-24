const mongoose = require('mongoose');
const Farmer = require('../models/Farmer');
const MilkCollection = require('../models/MilkCollection');

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/farmers?search=
// Lists farmers of the caller's organization. Optional search matches
// farmerId, name, village or phone.
exports.getFarmers = async (req, res) => {
  try {
    const query = { organizationId: req.user.organizationId };

    if (!isBlank(req.query.search)) {
      const pattern = new RegExp(escapeRegex(req.query.search), 'i');
      query.$or = [
        { farmerId: pattern },
        { name: pattern },
        { village: pattern },
        { phone: pattern }
      ];
    }

    const farmers = await Farmer.find(query).sort({ createdAt: -1 });
    return res.status(200).json(farmers);
  } catch (err) {
    console.error('getFarmers error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// POST /api/farmers
exports.createFarmer = async (req, res) => {
  try {
    const { farmerId, name, phone, village, address, status } = req.body || {};

    if (isBlank(farmerId) || isBlank(name) || isBlank(phone) || isBlank(village) || isBlank(address)) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    if (status !== undefined && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Status must be either active or inactive.' });
    }

    const trimmedFarmerId = String(farmerId).trim();

    const duplicate = await Farmer.findOne({
      organizationId: req.user.organizationId,
      farmerId: trimmedFarmerId
    });
    if (duplicate) {
      return res.status(400).json({ message: `Farmer ID "${trimmedFarmerId}" already exists.` });
    }

    const farmer = await Farmer.create({
      organizationId: req.user.organizationId,
      farmerId: trimmedFarmerId,
      name: String(name).trim(),
      phone: String(phone).trim(),
      village: String(village).trim(),
      address: String(address).trim(),
      status: status === undefined ? 'active' : status
    });

    return res.status(201).json({
      message: 'Farmer added successfully.',
      farmer
    });
  } catch (err) {
    console.error('createFarmer error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /api/farmers/:id
exports.getFarmerById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid farmer ID.' });
    }

    const farmer = await Farmer.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId
    });

    if (!farmer) {
      return res.status(404).json({ message: 'Farmer not found.' });
    }

    return res.status(200).json(farmer);
  } catch (err) {
    console.error('getFarmerById error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// PUT /api/farmers/:id
exports.updateFarmer = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid farmer ID.' });
    }

    const farmer = await Farmer.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId
    });

    if (!farmer) {
      return res.status(404).json({ message: 'Farmer not found.' });
    }

    const { farmerId, name, phone, village, address, status } = req.body || {};
    const updates = {};

    if (farmerId !== undefined) {
      if (isBlank(farmerId)) {
        return res.status(400).json({ message: 'Farmer ID cannot be empty.' });
      }
      const trimmedFarmerId = String(farmerId).trim();
      if (trimmedFarmerId !== farmer.farmerId) {
        const duplicate = await Farmer.findOne({
          organizationId: req.user.organizationId,
          farmerId: trimmedFarmerId
        });
        if (duplicate) {
          return res.status(400).json({ message: `Farmer ID "${trimmedFarmerId}" already exists.` });
        }
      }
      updates.farmerId = trimmedFarmerId;
    }
    if (name !== undefined) {
      if (isBlank(name)) return res.status(400).json({ message: 'Name cannot be empty.' });
      updates.name = String(name).trim();
    }
    if (phone !== undefined) {
      if (isBlank(phone)) return res.status(400).json({ message: 'Phone cannot be empty.' });
      updates.phone = String(phone).trim();
    }
    if (village !== undefined) {
      if (isBlank(village)) return res.status(400).json({ message: 'Village cannot be empty.' });
      updates.village = String(village).trim();
    }
    if (address !== undefined) {
      if (isBlank(address)) return res.status(400).json({ message: 'Address cannot be empty.' });
      updates.address = String(address).trim();
    }
    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ message: 'Status must be either active or inactive.' });
      }
      updates.status = status;
    }

    const updatedFarmer = await Farmer.findByIdAndUpdate(farmer._id, { $set: updates }, {
      new: true,
      runValidators: true
    });

    return res.status(200).json({
      message: 'Farmer updated successfully.',
      farmer: updatedFarmer
    });
  } catch (err) {
    console.error('updateFarmer error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// DELETE /api/farmers/:id
// A farmer with recorded milk collections cannot be deleted; the farmer
// should be deactivated instead so that history and reports stay intact.
exports.deleteFarmer = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid farmer ID.' });
    }

    const farmer = await Farmer.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId
    });

    if (!farmer) {
      return res.status(404).json({ message: 'Farmer not found.' });
    }

    const collectionCount = await MilkCollection.countDocuments({
      organizationId: req.user.organizationId,
      farmerId: farmer._id
    });

    if (collectionCount > 0) {
      return res.status(400).json({
        message: `This farmer has ${collectionCount} milk collection record(s) and cannot be deleted. Deactivate the farmer instead.`
      });
    }

    await Farmer.deleteOne({ _id: farmer._id });

    return res.status(200).json({ message: 'Farmer deleted successfully.' });
  } catch (err) {
    console.error('deleteFarmer error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};
