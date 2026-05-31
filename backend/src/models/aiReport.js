const mongoose = require('mongoose');

const aiReportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: String,
  report: Object,
}, { timestamps: true });

module.exports = mongoose.model('AIReport', aiReportSchema);
