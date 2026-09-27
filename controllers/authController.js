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

// GET /api/auth/profile
// Returns the Dairy Operator's own account plus the Organization record.
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const organization = await Organization.findOne({ _id: user.organizationId });
    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    return res.status(200).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        organizationId: user.organizationId
      },
      organization: {
        dairyName: organization.dairyName,
        ownerName: organization.ownerName,
        email: organization.email,
        phone: organization.phone,
        address: organization.address
      }
    });
  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// PUT /api/auth/profile
// Updates the Dairy Operator's account (name, email) and the Organization
// record (dairyName, ownerName, email, phone, address). Email stays unique.
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, dairyName, ownerName, phone, address } = req.body || {};

    if (isBlank(name) || isBlank(email) || isBlank(dairyName) || isBlank(ownerName) || isBlank(phone) || isBlank(address)) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    if (!EMAIL_REGEX.test(String(email).trim())) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const organization = await Organization.findOne({ _id: user.organizationId });
    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    // Email uniqueness across all users and organizations (excluding self).
    const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
    if (existingUser) {
      return res.status(400).json({ message: 'An account with this email already exists.' });
    }
    const existingOrganization = await Organization.findOne({ email: normalizedEmail, _id: { $ne: organization._id } });
    if (existingOrganization) {
      return res.status(400).json({ message: 'An account with this email already exists.' });
    }

    user.name = String(name).trim();
    user.email = normalizedEmail;
    await user.save();

    organization.dairyName = String(dairyName).trim();
    organization.ownerName = String(ownerName).trim();
    organization.email = normalizedEmail;
    organization.phone = String(phone).trim();
    organization.address = String(address).trim();
    await organization.save();

    return res.status(200).json({
      message: 'Profile updated successfully.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        organizationId: user.organizationId
      },
      organization: {
        dairyName: organization.dairyName,
        ownerName: organization.ownerName,
        email: organization.email,
        phone: organization.phone,
        address: organization.address
      }
    });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// PUT /api/auth/change-password
// Verifies the current password (bcrypt) before accepting the new one.
// Wrong current password returns 400 (not 401) so the client does not
// mistake it for an expired session.
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (isBlank(currentPassword) || isBlank(newPassword)) {
      return res.status(400).json({ message: 'Current password and new password are required.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await user.save();

    return res.status(200).json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('changePassword error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};
