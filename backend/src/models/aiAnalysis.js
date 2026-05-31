const mongoose = require('mongoose');

const aiAnalysisSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  originalLog: { type: String, required: true },
  cleanedLog: { type: String, required: true, index: true },
  logHash: { type: String, required: true, unique: true, index: true },
  aiResponse: { type: Object, required: true },
  severity: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('AIAnalysis', aiAnalysisSchema);
