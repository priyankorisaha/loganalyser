const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    timestamp: { type: String, required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: ['INFO', 'WARNING', 'ERROR', 'CRITICAL'],
      index: true,
    },
    source:  { type: String, default: 'unknown', index: true },
    message: { type: String, required: true, index: true },
    meta:    { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Log', logSchema);