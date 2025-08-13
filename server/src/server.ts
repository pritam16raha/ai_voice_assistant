import 'dotenv-flow/config';
import express from "express";
import cors from "cors";
import http from "http";
import { attachLiveRelay } from "./liveRelay.js";

const app = express();
app.use(cors());
app.get("/", (_req, res) => res.send("Revolt voice server running."));

const server = http.createServer(app);

const PORT = Number(process.env.PORT ?? 3000);
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash-live-001";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

attachLiveRelay(server, GEMINI_MODEL, GEMINI_API_KEY);

server.listen(PORT, () => {
  const ws = `ws://localhost:${PORT}/ws/client`;
  console.log(`✅ Server listening on http://localhost:${PORT}`);
  console.log(`WS endpoint: ${ws}`);
  console.log(`Model: ${GEMINI_MODEL}`);
});
