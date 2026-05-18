const jwt  = require('jsonwebtoken');
const User = require('../models/user');

const JWT_SECRET  = process.env.JWT_SECRET  || 'loglytics_secret_change_in_prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'username, email and password are required' });

    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists)
      return res.status(409).json({
        error: exists.email === email ? 'Email already registered' : 'Username already taken'
      });

    const user  = await User.create({ username, email, password });
    const token = signToken(user._id);

    return res.status(201).json({
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'username and password are required' });

    const user = await User.findOne({ username });
    if (!user)
      return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await user.comparePassword(password);
    if (!valid)
      return res.status(401).json({ error: 'Invalid username or password' });

    const token = signToken(user._id);
    return res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/auth/me  — verify token & return current user
exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};