// seed.js - demo data seeder for the Dairy Milk Collection Management System.
//
// Reads the environment from backend/.env (the same file the server uses)
// and fills MongoDB with one complete, ready-to-show demo dairy:
//
//   Organization : Sai Shraddha Dairy, owner Om More
//   Login        : ommore9175@gmail.com / ommore123
//   Farmers      : Durvesh More, Sumedh Jadhav, Om Nimbre,
//                  Omkar Mahamunkar, Aishwarya More, Atharv Ghadge
//   Rates        : Cow and Buffalo, each with an older and a current rate,
//                  so rate history and rate freezing are visible
//   Collections  : 35 days of morning/evening entries INCLUDING TODAY,
//                  so the dashboard, history, reports and statements
//                  all show data immediately
//
// Amounts are calculated exactly like the API does:
//   amount = round(liters x rate x 100) / 100
// and dates use the same timezone-safe YYYY-MM-DD strings as the app.
//
// The script REPLACES all existing data in the database.
//
// Run:  npm run seed    (or: node seed.js)

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Organization = require('./models/Organization');
const User = require('./models/User');
const Farmer = require('./models/Farmer');
const Rate = require('./models/Rate');
const MilkCollection = require('./models/MilkCollection');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dairy_management';

// ----- demo dairy -----------------------------------------------------------

const DAIRY = {
  dairyName: 'Sai Shraddha Dairy',
  ownerName: 'Om More',
  email: 'ommore9175@gmail.com',
  phone: '9822012345',
  address: 'Gat No. 42, Nagar Road, Shirur, Pune, Maharashtra 412701',
  password: 'ommore123'
};

// code, name, phone, village, address, milk type this farmer supplies
const FARMERS = [
  ['F-001', 'Durvesh More', '9822045011', 'Shirur', 'Near Gram Panchayat, Shirur', 'Cow'],
  ['F-002', 'Sumedh Jadhav', '9822045012', 'Nimgaon', 'Main Road, Nimgaon', 'Buffalo'],
  ['F-003', 'Om Nimbre', '9822045013', 'Kanhe', 'Kanhe Road, Kanhe', 'Cow'],
  ['F-004', 'Omkar Mahamunkar', '9822045014', 'Pargaon', 'Shivaji Chowk, Pargaon', 'Buffalo'],
  ['F-005', 'Aishwarya More', '9822045015', 'Sawal', 'Gaon Road, Sawal', 'Cow'],
  ['F-006', 'Atharv Ghadge', '9822045016', 'Kondhapuri', 'Market Road, Kondhapuri', 'Buffalo']
];

// milkType, rate, days ago it became effective.
// Two rates per milk type -> rate history + collections frozen at old rates.
const RATE_HISTORY = [
  ['Cow', 46, 34],
  ['Cow', 48, 11],
  ['Buffalo', 66, 34],
  ['Buffalo', 69, 11]
];

const DAYS_OF_HISTORY = 35;

// ----- helpers --------------------------------------------------------------

// Deterministic pseudo-random generator: every run seeds the same numbers.
let seedState = 20261012;
function rand() {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}

function randRange(min, max, decimals = 1) {
  const value = min + rand() * (max - min);
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// Calendar date string (YYYY-MM-DD) in the machine's local time, `days` ago.
// Same format the whole application uses for collection dates.
function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

// The rate that applies on a date: the newest rate whose effectiveFrom is
// on or before that date (same rule as the API's resolveRate).
function rateOn(rates, milkType, date) {
  const applicable = rates
    .filter((r) => r.milkType === milkType && r.effectiveFrom <= date)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return applicable.length ? applicable[0].rate : null;
}

// ----- seed -----------------------------------------------------------------

async function main() {
  console.log('Connecting to ' + MONGODB_URI + ' ...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  // Replace all existing data so the demo dairy is the only account.
  await Promise.all([
    MilkCollection.deleteMany({}),
    Farmer.deleteMany({}),
    Rate.deleteMany({}),
    User.deleteMany({}),
    Organization.deleteMany({})
  ]);
  console.log('Cleared existing data.');

  // Organization + login user (password hashed exactly like register does).
  const organization = await Organization.create({
    dairyName: DAIRY.dairyName,
    ownerName: DAIRY.ownerName,
    email: DAIRY.email,
    phone: DAIRY.phone,
    address: DAIRY.address
  });
  await User.create({
    organizationId: organization._id,
    name: DAIRY.ownerName,
    email: DAIRY.email,
    passwordHash: await bcrypt.hash(DAIRY.password, 10)
  });
  console.log('Created organization "' + DAIRY.dairyName + '" (owner: ' + DAIRY.ownerName + ').');

  // Rate history.
  const rates = [];
  for (const [milkType, rate, daysAgo] of RATE_HISTORY) {
    const created = await Rate.create({
      organizationId: organization._id,
      milkType,
      rate,
      effectiveFrom: isoDaysAgo(daysAgo)
    });
    rates.push({ milkType: created.milkType, rate: created.rate, effectiveFrom: created.effectiveFrom });
  }
  console.log('Created rates: Cow 46 -> 48, Buffalo 66 -> 69 (rate history visible).');

  // Farmers (all active).
  const farmers = [];
  for (const [code, name, phone, village, address, milkType] of FARMERS) {
    farmers.push(await Farmer.create({
      organizationId: organization._id,
      farmerId: code,
      name,
      phone,
      village,
      address,
      status: 'active'
    }));
  }
  console.log('Created ' + farmers.length + ' farmers: ' + FARMERS.map((f) => f[1]).join(', ') + '.');

  // Milk collections: 35 days, morning + evening, including today.
  // Typical quality values: Cow fat 3.5-4.3 / SNF 8.3-8.9,
  // Buffalo fat 6.1-7.2 / SNF 8.9-9.5. Morning volumes are heavier.
  const collections = [];
  let todayLiters = 0;
  let todayAmount = 0;
  let todayEntries = 0;
  let totalLiters = 0;
  let totalAmount = 0;

  for (let dayOffset = DAYS_OF_HISTORY - 1; dayOffset >= 0; dayOffset -= 1) {
    const date = isoDaysAgo(dayOffset);
    const isToday = dayOffset === 0;

    for (const farmer of farmers) {
      const milkType = FARMERS.find((f) => f[0] === farmer.farmerId)[5];
      const rate = rateOn(rates, milkType, date);
      if (rate === null) continue;

      // Today is always fully populated so the dashboard shows numbers.
      // Other days occasionally skip a shift, like a real dairy.
      const shifts = isToday
        ? ['Morning', 'Evening']
        : rand() > 0.25 ? ['Morning', 'Evening'] : [rand() > 0.5 ? 'Morning' : 'Evening'];

      for (const shift of shifts) {
        if (!isToday && rand() < 0.1) continue;

        const morning = shift === 'Morning';
        const liters = milkType === 'Cow'
          ? randRange(morning ? 7 : 5, morning ? 14 : 11, 1)
          : randRange(morning ? 4 : 3, morning ? 10 : 8, 1);
        const fat = milkType === 'Cow' ? randRange(3.5, 4.3, 1) : randRange(6.1, 7.2, 1);
        const snf = milkType === 'Cow' ? randRange(8.3, 8.9, 1) : randRange(8.9, 9.5, 1);
        const amount = Math.round(liters * rate * 100) / 100;

        collections.push({
          organizationId: organization._id,
          farmerId: farmer._id,
          date,
          shift,
          milkType,
          liters,
          fat,
          snf,
          rate,
          amount
        });

        totalLiters += liters;
        totalAmount += amount;
        if (isToday) {
          todayLiters += liters;
          todayAmount += amount;
          todayEntries += 1;
        }
      }
    }
  }

  await MilkCollection.insertMany(collections);

  console.log('');
  console.log('=================================================================');
  console.log('  Seed complete - demo data ready to show');
  console.log('=================================================================');
  console.log('  Dairy       : ' + DAIRY.dairyName + ' (' + DAIRY.ownerName + ')');
  console.log('  Login       : ' + DAIRY.email + ' / ' + DAIRY.password);
  console.log('  Farmers     : ' + farmers.length + ' active (3 cow, 3 buffalo)');
  console.log('  Rates       : Cow 46 -> 48 Rs/L, Buffalo 66 -> 69 Rs/L');
  console.log('  Collections : ' + collections.length + ' entries over ' + DAYS_OF_HISTORY + ' days');
  console.log('  TODAY       : ' + todayEntries + ' entries, ' +
    todayLiters.toFixed(1) + ' liters, Rs. ' + todayAmount.toFixed(2));
  console.log('  35-day total: ' + totalLiters.toFixed(1) + ' liters, Rs. ' + totalAmount.toFixed(2));
  console.log('=================================================================');
  console.log('  Start the backend (npm start) and login with the account above.');
  console.log('=================================================================');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
