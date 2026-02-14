# WebCLI MVP

Single-process MVP implementation for WebCLI using `Fastify + ws + node-pty + xterm-headless + xterm.js`.

## Project Structure

- `frontend/`: browser static assets and frontend resources.
- `backend/`: service-side TypeScript implementation.
- `tests/`: automated tests (`unit/` and `e2e/`).
- `docs/`: project documentation and protocol specs.
- `schemas/`: JSON Schemas for term/control/common protocols.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:8080`.

## Scripts

- `npm run dev`: start development server with auto-reload.
- `npm run build`: compile TypeScript to `dist/`.
- `npm run start`: run compiled server.
- `npm run test`: run unit tests.
- `npm run test:e2e`: run end-to-end tests.
- `npm run check`: build + tests.

## Environment Variables

- `PORT` (default: `8080`)
- `HOST` (default: `0.0.0.0`)
- `HISTORY_LIMIT` (default: `1000`)
