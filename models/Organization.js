const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    dairyName: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Organization', organizationSchema);
