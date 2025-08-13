import 'dotenv/config';
import http from 'http';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';

import { liveRouter } from './liveRouter.js';
import { attachLiveRelay } from './liveRelay.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/live', liveRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;

const MODEL = process.env.GEMINI_MODEL;
const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
  console.error('❌ Missing GOOGLE_API_KEY in environment.');
  process.exit(1);
}
if (!MODEL) {
  console.error('❌ Missing GEMINI_MODEL in environment.');
  process.exit(1);
}

attachLiveRelay(server, MODEL, API_KEY);

server.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
  console.log(`WS endpoint: ws://localhost:${PORT}/ws/client`);
  console.log(`Model: ${MODEL}`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});
