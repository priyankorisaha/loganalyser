const User = require('../models/user');

// GET /api/alert-settings
exports.getAlertSettings = async (req, res) => {
  const user = await User.findById(req.userId).select('emailAlertSettings').lean();
  return res.json({ settings: user?.emailAlertSettings || {} });
};

// PUT /api/alert-settings
exports.updateAlertSettings = async (req, res) => {
  const { enabled, recipientEmail, warningThreshold, errorThreshold } = req.body;

  const update = {
    emailAlertSettings: {
      enabled: Boolean(enabled),
      recipientEmail: (recipientEmail || '').trim().toLowerCase(),
      warningThreshold: Number(warningThreshold || 25),
      errorThreshold: Number(errorThreshold || 10),
    },
  };

  const user = await User.findByIdAndUpdate(req.userId, update, { new: true, runValidators: true })
    .select('emailAlertSettings')
    .lean();

  return res.json({ settings: user.emailAlertSettings });
};
