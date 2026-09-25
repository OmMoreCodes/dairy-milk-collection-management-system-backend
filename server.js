require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// The frontend is served from a different origin (for example Live Server on
// port 5500), so CORS is open during development. Content-Disposition is
// exposed so the browser can read the filename of PDF/Excel downloads.
app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/farmers', require('./routes/farmers'));
app.use('/api/rates', require('./routes/rates'));
app.use('/api/collections', require('./routes/collections'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/exports', require('./routes/exports'));

app.use('/api', (req, res) => {
  return res.status(404).json({ message: 'API route not found.' });
});

// Central error handler.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON in request body.' });
  }
  if (err && err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid ID format.' });
  }
  if (err && err.code === 11000) {
    return res.status(400).json({ message: 'Duplicate value: this record already exists.' });
  }
  if (err && err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }

  return res.status(500).json({ message: 'Internal server error.' });
});

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGODB_URI || !JWT_SECRET) {
  console.error('Missing MONGODB_URI or JWT_SECRET. Configure them in backend/.env');
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Dairy Management System API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
