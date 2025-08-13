import { Router } from 'express';

export const liveRouter = Router();

liveRouter.get('/config', (_req, res) => {
  res.json({
    wsUrl: '/ws/client',
    model: process.env.GEMINI_MODEL,
  });
});

liveRouter.post('/model', (req, res) => {
  const { model } = req.body ?? {};
  if (!model || typeof model !== 'string') {
    return res.status(400).json({ error: 'Provide { model: string }' });
  }
  process.env.GEMINI_MODEL = model;
  return res.json({ ok: true, model });
});
