const mongoose = require('mongoose');

const milkCollectionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    farmerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farmer',
      required: true,
      index: true
    },
    // Stored as a calendar date string in YYYY-MM-DD format (timezone-safe).
    date: { type: String, required: true, index: true },
    shift: {
      type: String,
      enum: ['Morning', 'Evening'],
      required: true
    },
    milkType: {
      type: String,
      enum: ['Cow', 'Buffalo'],
      required: true
    },
    liters: { type: Number, required: true, min: 0 },
    fat: { type: Number, required: true, min: 0, max: 100 },
    snf: { type: Number, required: true, min: 0, max: 100 },
    // Copied from the Rate document at the time of entry. Never recalculated.
    rate: { type: Number, required: true, min: 0 },
    // Always calculated server-side as liters x rate. Never accepted from the client.
    amount: { type: Number, required: true, min: 0 }
  },
  { timestamps: true }
);

milkCollectionSchema.index({ organizationId: 1, date: -1 });
milkCollectionSchema.index({ organizationId: 1, farmerId: 1, date: -1 });

module.exports = mongoose.model('MilkCollection', milkCollectionSchema);
