const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
  {
    timestamp: { type: String, required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: ['INFO', 'WARNING', 'ERROR'],
      index: true,
    },
    message: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Log', logSchema);
