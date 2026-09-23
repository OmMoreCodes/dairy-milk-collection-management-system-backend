const mongoose = require('mongoose');

const farmerSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    farmerId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    village: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    }
  },
  { timestamps: true }
);

// A farmerId must be unique inside one organization.
farmerSchema.index({ organizationId: 1, farmerId: 1 }, { unique: true });

module.exports = mongoose.model('Farmer', farmerSchema);
