const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'loglytics_secret_change_in_prod';

module.exports = function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token — please log in' });

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;   // attach userId to every request
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token — please log in again' });
  }
};