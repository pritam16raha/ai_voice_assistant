import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

function makeWavHeader(byteLength, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const blockAlign = (numChannels * bitsPerSample) >> 3;
  const byteRate = sampleRate * blockAlign;
  const chunkSize = 36 + byteLength;
  const b = Buffer.alloc(44);
  b.write('RIFF', 0);
  b.writeUInt32LE(chunkSize, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(numChannels, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(byteRate, 28);
  b.writeUInt16LE(blockAlign, 32);
  b.writeUInt16LE(bitsPerSample, 34);
  b.write('data', 36);
  b.writeUInt32LE(byteLength, 40);
  return b;
}

const WS_URL = 'ws://localhost:3000/ws/client';
const ws = new WebSocket(WS_URL);
const pcmChunks = [];
let opened = false;

ws.on('open', () => {
  console.log('WS open → sending start');
  ws.send(JSON.stringify({
    type: 'start',
    system: 'You are a friendly assistant for Revolt Motors.',
  }));
});

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  if (msg.type === 'status') {
    console.log('[status]', msg.value);
    if (msg.value === 'gemini_open' && !opened) {
      opened = true;
      ws.send(JSON.stringify({
        type: 'text',
        text: 'Say: "Hello from Revolt!" Keep it under five to ten seconds.',
      }));
    }
  }

  if (msg.type === 'error') {
    console.error('[error]', msg.error);
  }

  if (msg.type === 'audio') {
    pcmChunks.push(Buffer.from(msg.base64, 'base64'));
  }

  if (msg.type === 'turnComplete') {
    console.log('Turn complete → writing out.wav');
    const pcm = Buffer.concat(pcmChunks);
    const wav = Buffer.concat([makeWavHeader(pcm.length, 24000, 1, 16), pcm]);
    const outPath = path.resolve('./out.wav');
    fs.writeFileSync(outPath, wav);
    console.log('Saved', outPath);
    ws.close();
  }
});

ws.on('close', () => console.log('WS closed'));
ws.on('error', (e) => console.error('WS error', e));
