// API test suite for the profile management endpoints:
//   GET  /api/auth/profile
//   PUT  /api/auth/profile
//   PUT  /api/auth/change-password
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
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function main() {
  console.log('\n=== Profile: auth guard ===');

  let r = await api('GET', '/api/auth/profile');
  check('GET profile without token -> 401', r.status === 401);

  r = await api('PUT', '/api/auth/profile', {});
  check('PUT profile without token -> 401', r.status === 401);

  r = await api('PUT', '/api/auth/change-password', {});
  check('change-password without token -> 401', r.status === 401);

  console.log('\n=== Profile: setup two organizations ===');

  const emailA = RUN_PREFIX + '@profilea.com';
  const emailB = RUN_PREFIX + '@profileb.com';

  r = await api('POST', '/api/auth/register', {
    dairyName: 'Profile Dairy A', ownerName: 'Owner A', email: emailA,
    phone: '9000000011', address: 'A Street 1', password: 'alpha123'
  });
  check('org A registered', r.status === 201);

  r = await api('POST', '/api/auth/register', {
    dairyName: 'Profile Dairy B', ownerName: 'Owner B', email: emailB,
    phone: '9000000022', address: 'B Street 2', password: 'bravo123'
  });
  check('org B registered', r.status === 201);

  let loginA = await api('POST', '/api/auth/login', { email: emailA, password: 'alpha123' });
  const tokenA = loginA.data.token;
  let loginB = await api('POST', '/api/auth/login', { email: emailB, password: 'bravo123' });
  const tokenB = loginB.data.token;
  check('both logins return tokens', !!tokenA && !!tokenB);

  console.log('\n=== Profile: GET ===');

  r = await api('GET', '/api/auth/profile', undefined, tokenA);
  check('GET profile returns 200', r.status === 200);
  check('profile has user.name', r.data.user && r.data.user.name === 'Owner A');
  check('profile has user.email', r.data.user && r.data.user.email === emailA);
  check('profile has organization.dairyName', r.data.organization && r.data.organization.dairyName === 'Profile Dairy A');
  check('profile has organization phone + address', r.data.organization && r.data.organization.phone === '9000000011' && r.data.organization.address === 'A Street 1');
  check('profile does not expose passwordHash', !r.data.user.passwordHash);

  console.log('\n=== Profile: PUT validation ===');

  r = await api('PUT', '/api/auth/profile', { name: '', email: emailA, dairyName: 'D', ownerName: 'O', phone: '1', address: 'a' }, tokenA);
  check('rejects missing name (400)', r.status === 400);

  r = await api('PUT', '/api/auth/profile', { name: 'N', email: 'not-an-email', dairyName: 'D', ownerName: 'O', phone: '1', address: 'a' }, tokenA);
  check('rejects invalid email (400)', r.status === 400);

  r = await api('PUT', '/api/auth/profile', { name: 'N', email: emailB, dairyName: 'D', ownerName: 'O', phone: '1', address: 'a' }, tokenA);
  check('rejects email already used by another account (400)', r.status === 400);

  console.log('\n=== Profile: PUT happy path ===');

  const newEmailA = RUN_PREFIX + '-new@profilea.com';
  r = await api('PUT', '/api/auth/profile', {
    name: 'Owner A Updated',
    email: newEmailA,
    dairyName: 'Profile Dairy A Renamed',
    ownerName: 'Owner A Renamed',
    phone: '9000000999',
    address: 'A Street 42'
  }, tokenA);
  check('profile update returns 200', r.status === 200, JSON.stringify(r.data));
  check('response carries updated user', r.data.user && r.data.user.name === 'Owner A Updated' && r.data.user.email === newEmailA);
  check('response carries updated organization', r.data.organization && r.data.organization.dairyName === 'Profile Dairy A Renamed' && r.data.organization.phone === '9000000999');

  r = await api('GET', '/api/auth/profile', undefined, tokenA);
  check('update persisted (GET reflects changes)', r.status === 200 && r.data.user.name === 'Owner A Updated' && r.data.organization.address === 'A Street 42');

  r = await api('POST', '/api/auth/login', { email: newEmailA, password: 'alpha123' });
  check('login works with the new email', r.status === 200 && !!r.data.token);

  r = await api('POST', '/api/auth/login', { email: emailA, password: 'alpha123' });
  check('old email no longer logs in (401)', r.status === 401);

  console.log('\n=== Profile: organization isolation ===');

  r = await api('GET', '/api/auth/profile', undefined, tokenB);
  check('org B profile is untouched by org A updates', r.data.organization && r.data.organization.dairyName === 'Profile Dairy B');

  console.log('\n=== Change password ===');

  r = await api('PUT', '/api/auth/change-password', { currentPassword: '', newPassword: 'newpass1' }, tokenA);
  check('rejects missing current password (400)', r.status === 400);

  r = await api('PUT', '/api/auth/change-password', { currentPassword: 'alpha123', newPassword: '123' }, tokenA);
  check('rejects new password shorter than 6 chars (400)', r.status === 400);

  r = await api('PUT', '/api/auth/change-password', { currentPassword: 'wrong-current', newPassword: 'newpass1' }, tokenA);
  check('rejects wrong current password (400, not 401)', r.status === 400, 'status=' + r.status);
  check('wrong-current error explains the problem', (r.data.message || '').toLowerCase().includes('current password'));

  r = await api('PUT', '/api/auth/change-password', { currentPassword: 'alpha123', newPassword: 'newpass1' }, tokenA);
  check('password change succeeds (200)', r.status === 200);

  r = await api('POST', '/api/auth/login', { email: newEmailA, password: 'alpha123' });
  check('old password no longer logs in (401)', r.status === 401);

  r = await api('POST', '/api/auth/login', { email: newEmailA, password: 'newpass1' });
  check('new password logs in (200)', r.status === 200 && !!r.data.token);

  console.log('\n=== Result ===');
  console.log('passed: ' + passed + ', failed: ' + failed);
  if (failures.length) {
    console.log('failures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('suite crashed:', err);
  process.exit(1);
});
