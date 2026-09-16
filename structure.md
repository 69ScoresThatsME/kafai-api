# Kafai Backend Structure

This repository is the backend for Kafai, a small Express API backed by MongoDB through Mongoose. It supports username/password registration and login, JWT authentication, and per-user electricity usage CRUD.

The frontend lives in the sibling `../kafai` repository. Read `../structure.md` for the complete workspace map.

## File map

```text
kafai-api/
├── api/
│   └── index.js          # Builds and exports the Express app; Vercel entrypoint
├── config/
│   └── db.js             # MongoDB connection with a global serverless cache
├── middleware/
│   └── auth.js           # Reads and verifies Authorization Bearer JWTs
├── models/
│   ├── User.js           # User schema, mapped to MongoDB collection Users
│   └── Kafai.js          # Usage schema, mapped to MongoDB collection kafai
├── routes/
│   ├── auth.js           # POST /register and POST /login
│   └── kafai.js          # Authenticated usage CRUD
├── server.js             # Local launcher using app.listen
├── vercel.json            # Routes Vercel requests to api/index.js
├── .env.example          # Environment variable template
├── package.json           # Node scripts and dependencies
└── structure.md          # This guide
```

## Application composition

`api/index.js` creates the Express app in this order:

1. Loads CORS. If `ALLOWED_ORIGIN` exists, it is used as the allowed origin; otherwise CORS allows `*`.
2. Enables JSON request parsing with `express.json()`.
3. Runs an async database middleware before every request. It calls `connectDB()` and returns status 500 with an error if connection setup fails.
4. Exposes `GET /api` as a health response.
5. Mounts `routes/auth.js` at `/api/auth`.
6. Mounts `routes/kafai.js` at `/api/kafai`.
7. Returns JSON status 404 for every unmatched endpoint.

`server.js` loads dotenv, imports the app, and listens on `process.env.PORT || 3000`. Vercel imports `api/index.js` directly through the `@vercel/node` build configuration, so the listener in `server.js` is for local use.

## Authentication flow

### Registration

`POST /api/auth/register` expects JSON `{ username, password }`.

- Missing either field returns 400.
- An existing username returns 409.
- The password is hashed with `bcryptjs.hash(password, 10)`.
- A `User` document is created in the `Users` collection.
- Success returns 201 with `{ message, userId }`.

### Login

`POST /api/auth/login` expects JSON `{ username, password }`.

- Missing either field returns 400.
- A missing user or failed bcrypt comparison returns 401 with the same invalid-credentials error.
- Success signs a JWT containing `{ userId: user._id }` with `JWT_SECRET` and `expiresIn: '30d'`.
- Success returns 200 with `{ message, token, expiresIn: '30d' }`.

### Protected requests

The client must send:

```text
Authorization: Bearer <token>
```

`middleware/auth.js` rejects a missing or malformed header with 401. It calls `jwt.verify(token, process.env.JWT_SECRET)`, puts the decoded `userId` on `req.userId`, and calls `next()`. Invalid or expired tokens return 401.

There is no refresh-token or logout endpoint. Logging out is a frontend operation that removes the browser's JWT. Changing `JWT_SECRET` invalidates existing tokens.

## MongoDB models

The connection URI comes from `MONGODB_URI`. `config/db.js` strips surrounding quote characters, connects with `bufferCommands: false` and `family: 4`, and stores both the connection and in-flight promise on `global._mongooseCache`. This avoids opening a new connection for every warm Vercel invocation.

The database name is normally supplied by the URI, and the example URI uses `kafai`.

### `Users` collection (`models/User.js`)

| Field | Mongoose type | Rules |
|---|---|---|
| `username` | String | required, unique, trimmed |
| `password` | String | required; contains a bcrypt hash |
| `createdAt` | Date | automatic timestamp |
| `updatedAt` | Date | automatic timestamp |

The model is exported as `User` and explicitly uses the `Users` collection.

### `kafai` collection (`models/Kafai.js`)

| Field | Mongoose type | Rules |
|---|---|---|
| `userId` | ObjectId | required, references `User` |
| `recordedAt` | Date | required; when the value was actually recorded |
| `targetDate` | Date | required; schedule/date to which the value is assigned |
| `unit` | Number | required; electricity usage in kWh |
| `createdAt` | Date | automatic timestamp |
| `updatedAt` | Date | automatic timestamp |

There is an index on `{ userId: 1, targetDate: 1 }`. The schema does not define a minimum, maximum, or non-negative validation rule for `unit`; the frontend accepts numeric values and the API relies on the Mongoose `Number` type.

## API contract

All responses are JSON. Paths below include the `/api` prefix used by Express and Vercel.

| Method | Endpoint | Auth | Behavior |
|---|---|---|---|
| `GET` | `/api` | No | Health response. |
| `POST` | `/api/auth/register` | No | Create a user; 201, 400, 409, or 500. |
| `POST` | `/api/auth/login` | No | Validate credentials and issue a 30-day JWT; 200, 400, 401, or 500. |
| `POST` | `/api/kafai` | Bearer JWT | Create a record for `req.userId`; 201, 400, or 500. |
| `GET` | `/api/kafai` | Bearer JWT | Return only the current user's records, sorted by `targetDate` descending. |
| `GET` | `/api/kafai/:id` | Bearer JWT | Return one record only when both ID and `userId` match; 404 if absent. |
| `PUT` | `/api/kafai/:id` | Bearer JWT | Partially update `recordedAt`, `targetDate`, and/or `unit`, scoped to the user. |
| `DELETE` | `/api/kafai/:id` | Bearer JWT | Delete one record scoped to the user; returns `{ message }` on success. |

Create request:

```json
{
  "recordedAt": "2026-08-07",
  "targetDate": "2026-08-08",
  "unit": 123.5
}
```

Update request is partial, for example `{ "unit": 130 }`. The route constructs an update object only for truthy dates and for `unit !== undefined`, then uses `findOneAndUpdate(..., { new: true })`.

Create and update convert supplied date strings with `new Date(...)`. Successful create/update responses are the Mongoose document as JSON, including `_id`, `userId`, dates, `unit`, and timestamps.

## Authorization and data isolation

`router.use(authMiddleware)` is declared at the top of `routes/kafai.js`, so every usage endpoint is protected. Every read or mutation includes `userId: req.userId` in its MongoDB filter. Preserve this condition when adding endpoints; an ID by itself is never sufficient authorization.

The API does not return a user profile endpoint. The JWT's `userId` is the only authenticated identity passed into usage route handlers.

## Error behavior and caveats

- Missing/invalid/expired JWT: 401.
- Missing required create fields: 400.
- Duplicate username: 409.
- Missing record or record owned by another user: 404.
- Database, malformed ObjectId, date conversion, and other uncaught route errors are generally returned as 500 with `err.message`.
- The database connection middleware runs before even the health and 404 responses, so an unavailable MongoDB can make otherwise simple requests return 500.
- CORS is open to all origins when `ALLOWED_ORIGIN` is unset.
- Error messages currently include `err.message` in several 500 responses. Do not expose more internal detail when changing this behavior without an explicit decision.
- `unit` is required but can currently be negative or non-finite depending on how the request is parsed; add schema validation deliberately if product rules require it.
- The route checks `if (recordedAt)` and `if (targetDate)` on update, so an empty date cannot be used to clear a field. Required fields remain required in the database.

## Environment and commands

Create `.env` from `.env.example` and provide real values locally. Never commit `.env` or credentials.

```text
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/kafai?retryWrites=true&w=majority
JWT_SECRET=<long-random-secret>
PORT=3000
ALLOWED_ORIGIN=<optional-frontend-origin>
```

From this directory:

```bash
npm install
npm run dev       # nodemon server.js
npm start         # node server.js
```

The API is available locally at `http://localhost:<PORT>/api`. When running the frontend and backend together, choose a non-conflicting backend port and point the frontend's `NEXT_PUBLIC_API_URL` at it.

## Deployment

Vercel uses `vercel.json`:

```json
{
  "version": 2,
  "builds": [{ "src": "api/index.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "api/index.js" }]
}
```

Configure `MONGODB_URI`, `JWT_SECRET`, and, where needed, `ALLOWED_ORIGIN` in the Vercel project environment. The frontend's default production URL assumes this API is deployed at `https://kafai-api.vercel.app/api`; update `NEXT_PUBLIC_API_URL` if the deployment hostname changes.

## Change guide for agents

- Change request routing or middleware composition in `api/index.js`.
- Change local process startup in `server.js`.
- Change authentication semantics in `routes/auth.js` and/or `middleware/auth.js`; update the frontend client and both structure documents when the contract changes.
- Change usage behavior in `routes/kafai.js`.
- Change persisted fields/indexes in `models/User.js` or `models/Kafai.js`.
- Change MongoDB connection behavior in `config/db.js`.
- Keep route mount prefixes and frontend endpoint paths synchronized.
- Preserve `userId` filters on all usage queries and mutations.
- Use UTF-8 when editing the existing Thai messages.
- Validate syntax and affected behavior after changes, then inspect `git diff --check` and `git status` in this repository.
