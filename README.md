# Dairy Milk Collection Management System — Backend

REST API for the Dairy Milk Collection Management System, built with **Node.js + Express.js** and **MongoDB + Mongoose**. Authentication uses **JWT + bcrypt**.

The matching frontend lives in the sibling `frontend/` folder of this project.

## Requirements

- Node.js 18 or newer
- MongoDB running locally (or a MongoDB Atlas connection string)

## Setup

```bash
npm install
```

Create your environment file (copy the example and fill in real values):

```bash
cp .env.example .env
```

`.env`:

```
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/dairy_management
JWT_SECRET=change_this_to_a_long_random_string
```

## Run

```bash
npm start
```

The API runs on `http://localhost:5000`. It works with a local MongoDB or MongoDB Atlas — switching between them only requires changing `MONGODB_URI` in `.env`.

## Seed demo data

```bash
npm run seed
```

Fills the database (using `MONGODB_URI` from `.env`) with one complete demo dairy: **Sai Shraddha Dairy**, owner **Om More** (login `ommore9175@gmail.com` / `ommore123`), six active farmers, a Cow 46→48 and Buffalo 66→69 rate history, and 35 days of morning/evening collections **including today** — so the dashboard, history, reports, statements and exports all show data immediately.

The script replaces all existing data before seeding, and repeated runs produce the same numbers (deterministic). Skip it if you want to start with an empty database.

## Test

```bash
npm test
```

Runs the full automated test suite (101 checks) from the `tests/` folder:

| Suite | Checks | Covers |
|-------|--------|--------|
| `tests/test-api.js` | 69 | validation rules, authentication, organization isolation, server-side amount calculation, rate freezing, reports and exports (PDF + Excel) |
| `tests/test-profile.js` | 29 | profile get/update and password change endpoints |
| `tests/test-exceljs-uuid.js` | 3 | Excel generation with the pinned uuid override |

MongoDB must be reachable. The runner (`tests/run-all.js`) starts the API automatically if it is not already running on port 5000, and stops it again afterwards. If the API is already running, the suites are executed against that instance.

## Project Structure

```
backend/
├── server.js          # Express app entry point
├── routes/            # auth, farmers, rates, collections, reports, exports
├── controllers/       # business logic per area
├── models/            # Organization, User, Farmer, Rate, MilkCollection
├── middleware/        # JWT auth guard
├── tests/             # automated test suites + runner
├── .env.example       # environment template
└── package.json
```

## API Overview

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET/PUT /api/auth/profile`, `PUT /api/auth/change-password` |
| Farmers | `GET/POST /api/farmers`, `GET/PUT/DELETE /api/farmers/:id` |
| Rates | `GET/POST /api/rates`, `PUT /api/rates/:id` |
| Collections | `GET/POST /api/collections`, `GET /api/collections/:id` |
| Reports | `GET /api/reports/daily\|monthly\|range\|statement` |
| Exports | `GET /api/exports/pdf/daily\|monthly\|range\|statement`, `GET /api/exports/excel` |

All endpoints except register/login require an `Authorization: Bearer <token>` header.

## Key Business Rules

- `amount` is always calculated server-side as `liters × rate` and is never accepted from the client
- The `rate` stored on a milk collection is copied from the current Rate document at entry time and is never recalculated
- Every database query is scoped to the caller's `organizationId` — organizations cannot see each other's data
- Farmers with recorded collections cannot be deleted (deactivate them instead)

## Dependency Note

`package.json` contains a scoped npm override that pins `uuid` to `^11.1.1` inside exceljs's dependency tree (resolves the npm audit advisory without downgrading exceljs). It requires npm 8.3 or newer and is safe to remove if exceljs ever ships the fix itself.
