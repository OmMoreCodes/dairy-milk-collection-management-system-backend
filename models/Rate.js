const mongoose = require('mongoose');

const rateSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    milkType: {
      type: String,
      enum: ['Cow', 'Buffalo'],
      required: true
    },
    rate: { type: Number, required: true, min: 0 },
    // Calendar date string in YYYY-MM-DD format from which this rate applies.
    effectiveFrom: { type: String, required: true, index: true }
  },
  { timestamps: true }
);

rateSchema.index({ organizationId: 1, milkType: 1, effectiveFrom: -1 });

module.exports = mongoose.model('Rate', rateSchema);
