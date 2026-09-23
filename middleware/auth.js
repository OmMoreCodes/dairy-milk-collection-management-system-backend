const jwt = require('jsonwebtoken');

// Verifies the JWT sent in the Authorization header and attaches
// { id, organizationId, name } to req.user. The organizationId claim is
// set at login time and is used by every controller to scope database
// queries to the caller's own organization.
module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ message: 'Access denied. Please login to continue.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.id || !decoded.organizationId) {
      return res.status(401).json({ message: 'Invalid token. Please login again.' });
    }

    req.user = {
      id: decoded.id,
      organizationId: decoded.organizationId,
      name: decoded.name
    };
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired session. Please login again.' });
  }
};
