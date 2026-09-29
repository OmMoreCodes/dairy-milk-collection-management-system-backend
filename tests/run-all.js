// tests/run-all.js - backend test runner (npm test).
//
// What it does:
//   1. Checks whether the API is already running on http://localhost:5000.
//      If it is, the suites run against that instance (it is left running).
//   2. If not, starts `node server.js` as a child process, waits for it to
//      become reachable, runs the suites and shuts it down afterwards.
//
// Requirements: MongoDB must be reachable (the MONGODB_URI in backend/.env)
// and backend/.env must exist (copy .env.example if it does not).

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..');
const API = 'http://localhost:5000';
const SUITES = ['test-api.js', 'test-profile.js', 'test-exceljs-uuid.js'];
const STARTUP_TIMEOUT_MS = 40000;

function apiIsUp() {
  // Any HTTP answer (including the 404 JSON) proves the API is listening.
  return fetch(API + '/api/__startup_probe__')
    .then(() => true)
    .catch(() => false);
}

async function main() {
  let server = null;
  let serverLog = '';

  if (await apiIsUp()) {
    console.log('API already running on ' + API + ' - testing against it.\n');
  } else {
    console.log('API not running - starting the backend server for this test run...');
    server = spawn(process.execPath, ['server.js'], {
      cwd: BACKEND_ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', (d) => { serverLog += d.toString(); });
    server.stderr.on('data', (d) => { serverLog += d.toString(); });

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let up = false;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) break; // process died during startup
      if (await apiIsUp()) { up = true; break; }
      await new Promise((r) => setTimeout(r, 400));
    }

    if (!up) {
      console.error('\nCould not start the backend server. Server output:\n');
      console.error(serverLog.trim() || '(no output)');
      console.error('\nHints:');
      console.error('  - Is MongoDB running? (start mongod, or point MONGODB_URI in backend/.env at MongoDB Atlas)');
      console.error('  - Does backend/.env exist with PORT / MONGODB_URI / JWT_SECRET? (cp .env.example .env)');
      if (server.exitCode === null) server.kill('SIGTERM');
      process.exit(1);
    }
    console.log('Backend server started.\n');
  }

  let failed = false;
  for (const suite of SUITES) {
    console.log('============================================================');
    console.log('  ' + suite);
    console.log('============================================================');
    const result = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
    if (result.status !== 0) failed = true;
  }

  if (server) {
    server.kill('SIGTERM');
    console.log('\nBackend server (started by this test run) has been stopped.');
  }

  console.log('\n============================================================');
  if (failed) {
    console.log('  RESULT: FAILURES DETECTED - see the failing suite above.');
    console.log('============================================================');
    process.exit(1);
  }
  console.log('  RESULT: ALL TEST SUITES PASSED');
  console.log('============================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
