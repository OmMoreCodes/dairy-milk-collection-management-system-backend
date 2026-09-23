const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Organization = require('../models/Organization');
const User = require('../models/User');

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

// POST /api/auth/register
// Creates an Organization and its first User (the Dairy Operator) in one step.
exports.register = async (req, res) => {
  try {
    const { dairyName, ownerName, email, phone, address, password } = req.body || {};

    if (isBlank(dairyName) || isBlank(ownerName) || isBlank(email) || isBlank(phone) || isBlank(address)) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    if (!EMAIL_REGEX.test(String(email).trim())) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (isBlank(password) || String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingOrganization = await Organization.findOne({ email: normalizedEmail });
    if (existingOrganization) {
      return res.status(400).json({ message: 'An account with this email already exists.' });
    }
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'An account with this email already exists.' });
    }

    const organization = await Organization.create({
      dairyName: String(dairyName).trim(),
      ownerName: String(ownerName).trim(),
      email: normalizedEmail,
      phone: String(phone).trim(),
      address: String(address).trim()
    });

    const passwordHash = await bcrypt.hash(String(password), 10);

    await User.create({
      organizationId: organization._id,
      name: String(ownerName).trim(),
      email: normalizedEmail,
      passwordHash
    });

    return res.status(201).json({
      message: 'Organization registered successfully. Please login to continue.',
      organization: {
        dairyName: organization.dairyName,
        ownerName: organization.ownerName,
        email: organization.email
      }
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// POST /api/auth/login
// Verifies credentials and issues a JWT containing id, organizationId and name.
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (isBlank(email) || isBlank(password)) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(String(password), user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const organization = await Organization.findById(user.organizationId);
    if (!organization) {
      return res.status(401).json({ message: 'Organization not found. Please contact support.' });
    }

    const token = jwt.sign(
      {
        id: user._id,
        organizationId: user.organizationId,
        name: user.name
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        organizationId: user.organizationId
      },
      organization: {
        dairyName: organization.dairyName,
        ownerName: organization.ownerName
      }
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// POST /api/auth/logout
// JWT authentication is stateless, so logout is completed on the client by
// removing the stored token. This endpoint confirms the action.
exports.logout = async (req, res) => {
  return res.status(200).json({ message: 'Logged out successfully.' });
};
