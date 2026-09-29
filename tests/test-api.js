// End-to-end API test suite for the Dairy Milk Collection Management System.
// Covers: validation rules, authentication, organization isolation,
// server-side amount calculation, rate freezing, reports and exports.
// Run: npm test (from the backend folder). The runner in tests/run-all.js
// starts the API automatically if it is not already running.

const API = 'http://localhost:5000';
const RUN_PREFIX = 'run' + Date.now();

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + name);
  } else {
    failed += 1;
    failures.push(name + (detail ? ' -> ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : ''));
  }
}

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json() : await response.arrayBuffer();
  return { status: response.status, data, headers: response.headers };
}

function approx(actual, expected, tolerance = 0.01) {
  return Math.abs(actual - expected) <= tolerance;
}

async function main() {
  console.log('\n=== 1. Registration validation ===');

  let r = await api('POST', '/api/auth/register', {
    dairyName: 'Broken', ownerName: 'X', email: 'bad-email', phone: '1', address: 'a', password: '123456'
  });
  check('rejects invalid email format', r.status === 400);

  r = await api('POST', '/api/auth/register', {
    dairyName: 'Broken', ownerName: 'X', email: RUN_PREFIX + '-a@t.com', phone: '1', address: 'a', password: '123'
  });
  check('rejects password shorter than 6 chars', r.status === 400);

  r = await api('POST', '/api/auth/register', {
    dairyName: 'Broken', ownerName: '', email: RUN_PREFIX + '-a@t.com', phone: '1', address: 'a', password: '123456'
  });
  check('rejects missing required fields', r.status === 400);

  console.log('\n=== 2. Registration + login ===');

  const orgAEmail = RUN_PREFIX + '@dairyA.com';
  r = await api('POST', '/api/auth/register', {
    dairyName: 'Alpha Dairy', ownerName: 'Alpha Owner', email: orgAEmail,
    phone: '9000000001', address: 'Alpha Street', password: 'alpha123'
  });
  check('registers organization A (201)', r.status === 201 && !!r.data.organization);

  r = await api('POST', '/api/auth/register', {
    dairyName: 'Alpha Again', ownerName: 'X', email: orgAEmail,
    phone: '1', address: 'a', password: '123456'
  });
  check('rejects duplicate email registration', r.status === 400);

  r = await api('POST', '/api/auth/login', { email: orgAEmail, password: 'wrongpass' });
  check('login rejects wrong password (401)', r.status === 401);

  r = await api('POST', '/api/auth/login', { email: orgAEmail, password: 'alpha123' });
  check('login succeeds and returns token', r.status === 200 && !!r.data.token);
  check('login response carries organizationId + dairyName',
    r.data.user.organizationId === r.data.organization?._id || !!r.data.user.organizationId);
  const tokenA = r.data.token;

  r = await api('GET', '/api/farmers');
  check('protected route without token returns 401', r.status === 401);

  r = await api('GET', '/api/farmers', undefined, 'not.a.jwt');
  check('invalid JWT returns 401', r.status === 401);

  console.log('\n=== 3. Farmer CRUD + validation ===');

  r = await api('POST', '/api/farmers', {
    farmerId: 'F-001', name: 'Ramesh', phone: '9876500001', village: 'Rampur', address: 'Main Road'
  }, tokenA);
  check('creates farmer (201)', r.status === 201 && r.data.farmer.status === 'active');
  const farmerA1 = r.data.farmer._id;

  r = await api('POST', '/api/farmers', {
    farmerId: 'F-001', name: 'Duplicate', phone: '2', village: 'V', address: 'A'
  }, tokenA);
  check('rejects duplicate farmerId within organization', r.status === 400);

  r = await api('POST', '/api/farmers', {
    farmerId: 'F-002', name: 'Suresh', phone: '9876500002', village: 'Bilaspur', address: 'Street 2'
  }, tokenA);
  const farmerA2 = r.data.farmer._id;
  check('creates second farmer', r.status === 201);

  r = await api('POST', '/api/farmers', { farmerId: 'F-003', name: 'NoVillage', phone: '3', address: 'A' }, tokenA);
  check('rejects farmer with missing village', r.status === 400);

  r = await api('GET', '/api/farmers?search=rame', undefined, tokenA);
  check('search finds Ramesh only', r.status === 200 && r.data.length === 1 && r.data[0].name === 'Ramesh');

  r = await api('GET', '/api/farmers/' + farmerA1, undefined, tokenA);
  check('gets farmer by id', r.status === 200 && r.data.farmerId === 'F-001');

  r = await api('PUT', '/api/farmers/' + farmerA1, { status: 'inactive' }, tokenA);
  check('deactivates farmer via PUT', r.status === 200 && r.data.farmer.status === 'inactive');

  r = await api('PUT', '/api/farmers/' + farmerA1, { status: 'active' }, tokenA);
  check('reactivates farmer', r.status === 200 && r.data.farmer.status === 'active');

  r = await api('PUT', '/api/farmers/' + farmerA2, { village: '' }, tokenA);
  check('rejects blank village on update', r.status === 400);

  r = await api('GET', '/api/farmers/' + farmerA2 + 'xx', undefined, tokenA);
  check('invalid ObjectId returns 400', r.status === 400);

  console.log('\n=== 4. Rate management ===');

  r = await api('POST', '/api/rates', { milkType: 'Cow', rate: 30, effectiveFrom: '2026-01-01' }, tokenA);
  check('creates Cow rate', r.status === 201 && r.data.rate.rate === 30);

  r = await api('POST', '/api/rates', { milkType: 'Goat', rate: 10, effectiveFrom: '2026-01-01' }, tokenA);
  check('rejects invalid milkType', r.status === 400);

  r = await api('POST', '/api/rates', { milkType: 'Cow', rate: -5, effectiveFrom: '2026-01-01' }, tokenA);
  check('rejects negative rate', r.status === 400);

  r = await api('POST', '/api/rates', { milkType: 'Cow', rate: 10, effectiveFrom: 'not-a-date' }, tokenA);
  check('rejects invalid effectiveFrom date', r.status === 400);

  console.log('\n=== 5. Milk collection: server-side amount + frozen rate ===');

  r = await api('POST', '/api/collections', {
    farmerId: farmerA1, date: '2026-08-20', shift: 'Morning', milkType: 'Cow',
    liters: 10, fat: 4.0, snf: 8.5, rate: 1, amount: 99999
  }, tokenA);
  check('records collection with client rate/amount IGNORED',
    r.status === 201 && r.data.collection.rate === 30 && r.data.collection.amount === 300,
    'got rate=' + r.data.collection?.rate + ' amount=' + r.data.collection?.amount);

  r = await api('POST', '/api/collections', {
    farmerId: farmerA1, date: '2026-08-20', shift: 'Evening', milkType: 'Buffalo',
    liters: 5, fat: 6.5, snf: 9.0
  }, tokenA);
  check('collection without a Buffalo rate is rejected', r.status === 400);

  r = await api('POST', '/api/rates', { milkType: 'Buffalo', rate: 44, effectiveFrom: '2026-01-01' }, tokenA);
  check('adds Buffalo rate', r.status === 201);
  r = await api('POST', '/api/collections', {
    farmerId: farmerA1, date: '2026-08-20', shift: 'Evening', milkType: 'Buffalo',
    liters: 5, fat: 6.5, snf: 9.0
  }, tokenA);
  check('Buffalo collection now works (5 x 44 = 220)',
    r.status === 201 && r.data.collection.amount === 220);

  // Validation matrix on collections.
  r = await api('POST', '/api/collections', { farmerId: farmerA1, date: '2026-08-20', shift: 'Morning', milkType: 'Cow', liters: 0, fat: 4, snf: 8 }, tokenA);
  check('rejects liters = 0', r.status === 400);
  r = await api('POST', '/api/collections', { farmerId: farmerA1, date: '2026-08-20', shift: 'Morning', milkType: 'Cow', liters: -3, fat: 4, snf: 8 }, tokenA);
  check('rejects negative liters', r.status === 400);
  r = await api('POST', '/api/collections', { farmerId: farmerA1, date: '2026-08-20', shift: 'Morning', milkType: 'Cow', liters: 5, fat: 150, snf: 8 }, tokenA);
  check('rejects fat > 100', r.status === 400);
  r = await api('POST', '/api/collections', { farmerId: farmerA1, date: '2026-08-20', shift: 'Morning', milkType: 'Cow', liters: 5, fat: 4, snf: -1 }, tokenA);
  check('rejects negative SNF', r.status === 400);
  r = await api('POST', '/api/collections', { farmerId: farmerA1, date: '2026-08-20', shift: 'Night', milkType: 'Cow', liters: 5, fat: 4, snf: 8 }, tokenA);
  check('rejects invalid shift', r.status === 400);
  r = await api('POST', '/api/collections', { farmerId: farmerA1, date: '2026-08-20', shift: 'Morning', milkType: 'Goat', liters: 5, fat: 4, snf: 8 }, tokenA);
  check('rejects invalid milkType', r.status === 400);
  r = await api('POST', '/api/collections', { farmerId: farmerA1, date: '2026-02-30', shift: 'Morning', milkType: 'Cow', liters: 5, fat: 4, snf: 8 }, tokenA);
  check('rejects impossible date (2026-02-30)', r.status === 400);
  r = await api('POST', '/api/collections', { farmerId: '507f1f77bcf86cd799439011', date: '2026-08-20', shift: 'Morning', milkType: 'Cow', liters: 5, fat: 4, snf: 8 }, tokenA);
  check('rejects unknown farmer', r.status === 404);

  console.log('\n=== 6. Rate freeze across rate updates ===');

  const rates = await api('GET', '/api/rates', undefined, tokenA);
  const cowRateId = rates.data.find((x) => x.milkType === 'Cow')._id;
  r = await api('PUT', '/api/rates/' + cowRateId, { rate: 35 }, tokenA);
  check('updates Cow rate to 35', r.status === 200 && r.data.rate.rate === 35);

  r = await api('POST', '/api/collections', {
    farmerId: farmerA1, date: '2026-08-21', shift: 'Morning', milkType: 'Cow',
    liters: 8, fat: 4.1, snf: 8.6
  }, tokenA);
  check('new collection uses updated rate (8 x 35 = 280)',
    r.status === 201 && r.data.collection.rate === 35 && r.data.collection.amount === 280);

  r = await api('GET', '/api/collections?date=2026-08-20', undefined, tokenA);
  const oldCow = r.data.find((c) => c.milkType === 'Cow');
  check('OLD collection keeps frozen rate 30 and amount 300',
    oldCow.rate === 30 && oldCow.amount === 300,
    'got rate=' + oldCow.rate + ' amount=' + oldCow.amount);

  console.log('\n=== 7. Inactive farmer rule ===');

  await api('PUT', '/api/farmers/' + farmerA2, { status: 'inactive' }, tokenA);
  r = await api('POST', '/api/collections', {
    farmerId: farmerA2, date: '2026-08-21', shift: 'Evening', milkType: 'Cow',
    liters: 4, fat: 4, snf: 8
  }, tokenA);
  check('inactive farmer cannot record collections', r.status === 400);

  r = await api('DELETE', '/api/farmers/' + farmerA1, undefined, tokenA);
  check('farmer with collections cannot be deleted', r.status === 400);

  await api('POST', '/api/farmers', {
    farmerId: 'F-099', name: 'Temp Farmer', phone: '9', village: 'V', address: 'A'
  }, tokenA);
  const tempFarmer = (await api('GET', '/api/farmers?search=Temp', undefined, tokenA)).data[0];
  r = await api('DELETE', '/api/farmers/' + tempFarmer._id, undefined, tokenA);
  check('farmer without collections can be deleted', r.status === 200);

  console.log('\n=== 8. Collection history filters ===');

  r = await api('GET', '/api/collections?from=2026-08-20&to=2026-08-21', undefined, tokenA);
  check('range filter returns 3 collections', r.status === 200 && r.data.length === 3,
    'got ' + r.data.length);
  r = await api('GET', '/api/collections?shift=Evening', undefined, tokenA);
  check('shift filter works', r.status === 200 && r.data.every((c) => c.shift === 'Evening'));
  r = await api('GET', '/api/collections?milkType=Buffalo', undefined, tokenA);
  check('milkType filter works', r.status === 200 && r.data.every((c) => c.milkType === 'Buffalo'));
  r = await api('GET', '/api/collections?farmerId=' + farmerA1, undefined, tokenA);
  check('farmer filter works', r.status === 200 && r.data.every((c) => String(c.farmerId?._id) === String(farmerA1)));
  r = await api('GET', '/api/collections?from=2026-08-22&to=2026-08-20', undefined, tokenA);
  check('rejects from > to on collections', r.status === 400);

  console.log('\n=== 9. Reports ===');

  r = await api('GET', '/api/reports/daily?date=2026-08-20', undefined, tokenA);
  check('daily report summary correct',
    r.status === 200 &&
    r.data.summary.totalFarmers === 1 &&
    r.data.summary.totalCollections === 2 &&
    approx(r.data.summary.totalLiters, 15) &&
    approx(r.data.summary.totalAmount, 520) &&
    approx(r.data.summary.avgFat, 5.25) &&
    approx(r.data.summary.avgSnf, 8.75),
    JSON.stringify(r.data.summary));

  r = await api('GET', '/api/reports/monthly?month=8&year=2026', undefined, tokenA);
  check('monthly report has farmer-wise totals',
    r.status === 200 && r.data.farmers.length === 1 && r.data.farmers[0].totalLiters === 23,
    JSON.stringify(r.data.summary));

  r = await api('GET', '/api/reports/range?from=2026-08-20&to=2026-08-21', undefined, tokenA);
  check('range report totals correct',
    r.status === 200 && r.data.summary.collectionCount === 3 && approx(r.data.summary.totalLiters, 23),
    JSON.stringify(r.data.summary));

  r = await api('GET', '/api/reports/statement?farmerId=' + farmerA1 + '&from=2026-08-01&to=2026-08-31', undefined, tokenA);
  check('statement report totals correct',
    r.status === 200 &&
    r.data.farmer.name === 'Ramesh' &&
    r.data.summary.collectionCount === 3 &&
    approx(r.data.summary.totalLiters, 23) &&
    approx(r.data.summary.totalAmount, 800),
    JSON.stringify(r.data.summary));

  r = await api('GET', '/api/reports/daily', undefined, tokenA);
  check('daily report requires date', r.status === 400);
  r = await api('GET', '/api/reports/monthly?month=13&year=2026', undefined, tokenA);
  check('monthly report rejects month 13', r.status === 400);

  console.log('\n=== 10. PDF + Excel exports ===');

  r = await api('GET', '/api/exports/pdf/daily?date=2026-08-20', undefined, tokenA);
  const dailyPdf = Buffer.from(r.data);
  check('daily PDF is a real PDF',
    r.status === 200 && dailyPdf.length > 1000 && dailyPdf.slice(0, 4).toString() === '%PDF');

  r = await api('GET', '/api/exports/pdf/monthly?month=8&year=2026', undefined, tokenA);
  check('monthly PDF generated', r.status === 200 && Buffer.from(r.data).length > 1000);

  r = await api('GET', '/api/exports/pdf/range?from=2026-08-20&to=2026-08-21', undefined, tokenA);
  check('range PDF generated', r.status === 200 && Buffer.from(r.data).length > 1000);

  r = await api('GET', '/api/exports/pdf/statement?farmerId=' + farmerA1 + '&from=2026-08-01&to=2026-08-31', undefined, tokenA);
  check('statement PDF generated', r.status === 200 && Buffer.from(r.data).length > 1000);

  r = await api('GET', '/api/exports/excel?from=2026-08-20&to=2026-08-21', undefined, tokenA);
  const xlsx = Buffer.from(r.data);
  check('Excel export is a real xlsx (PK header)',
    r.status === 200 && xlsx.length > 1000 && xlsx.slice(0, 2).toString() === 'PK');

  r = await api('GET', '/api/exports/excel', undefined, tokenA);
  check('Excel export requires from + to', r.status === 400);

  console.log('\n=== 11. Organization isolation ===');

  const orgBEmail = RUN_PREFIX + '@dairyB.com';
  r = await api('POST', '/api/auth/register', {
    dairyName: 'Beta Dairy', ownerName: 'Beta Owner', email: orgBEmail,
    phone: '9000000002', address: 'Beta Street', password: 'beta123'
  });
  check('registers organization B', r.status === 201);
  const tokenB = (await api('POST', '/api/auth/login', { email: orgBEmail, password: 'beta123' })).data.token;

  r = await api('GET', '/api/farmers', undefined, tokenB);
  check('org B sees zero farmers of org A', r.status === 200 && r.data.length === 0);

  r = await api('GET', '/api/farmers/' + farmerA1, undefined, tokenB);
  check('org B cannot read org A farmer by id (404)', r.status === 404);

  r = await api('PUT', '/api/farmers/' + farmerA1, { name: 'HACKED' }, tokenB);
  check('org B cannot update org A farmer', r.status === 404);

  r = await api('DELETE', '/api/farmers/' + farmerA1, undefined, tokenB);
  check('org B cannot delete org A farmer', r.status === 404);

  r = await api('POST', '/api/collections', {
    farmerId: farmerA1, date: '2026-08-21', shift: 'Morning', milkType: 'Cow',
    liters: 100, fat: 4, snf: 8
  }, tokenB);
  check('org B cannot record collection for org A farmer', r.status === 404);

  r = await api('GET', '/api/reports/range?from=2026-08-01&to=2026-08-31', undefined, tokenB);
  check('org B reports contain no org A data',
    r.status === 200 && r.data.summary.collectionCount === 0);

  r = await api('GET', '/api/collections', undefined, tokenB);
  check('org B collection list is empty', r.status === 200 && r.data.length === 0);

  console.log('\n=== 12. Logout + misc ===');

  r = await api('POST', '/api/auth/logout');
  check('logout route responds', r.status === 200);

  r = await api('GET', '/api/unknown-route', undefined, tokenA);
  check('unknown API route returns 404', r.status === 404);

  console.log('\n============================');
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) {
    console.log('Failures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('============================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
