import { motion } from "framer-motion";
import {
  CircleStop,
  Loader2,
  Mic,
  MicOff,
  Power,
  Send,
  Zap,
  Globe,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import BlobAvatar from "./BlobAvatar";

declare global {
  interface Window {
    webkitAudioContext?: {
      new (contextOptions?: AudioContextOptions): AudioContext;
      prototype: AudioContext;
    };
  }
}

function float32ToPCM16Base64(f32: Float32Array): string {
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    pcm[i] = (s < 0 ? s * 0x8000 : s * 0x7fff) | 0;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64PCMtoFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const len = bin.length / 2;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const lo = bin.charCodeAt(2 * i);
    const hi = bin.charCodeAt(2 * i + 1);
    const val = (hi << 8) | lo;
    const s = val > 0x7fff ? val - 0x10000 : val;
    out[i] = s / 32768;
  }
  return out;
}

function resampleFloat32(
  input: Float32Array,
  inRate: number,
  outRate = 16000
): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    out[i] = input[i0] + (input[i1] - input[i0]) * frac;
  }
  return out;
}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, buf.length));
}

const WORKLET_CODE = `
class PCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.paused = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.cmd === 'flush') { this.queue = []; return; }
      if (d && d.cmd === 'pause') { this.paused = true; return; }
      if (d && d.cmd === 'resume') { this.paused = false; return; }
      if (d && d.length !== undefined) { this.queue.push(d); }
    };
  }
  process(_inputs, outputs) {
    if (this.paused) return true;
    const output = outputs[0][0];
    output.fill(0);
    if (this.queue.length === 0) return true;
    let buf = this.queue[0];
    let i = 0;
    while (i < output.length) {
      if (buf.length === 0) {
        this.queue.shift();
        if (this.queue.length === 0) break;
        buf = this.queue[0];
        continue;
      }
      const toCopy = Math.min(output.length - i, buf.length);
      output.set(buf.subarray(0, toCopy), i);
      i += toCopy;
      buf = buf.subarray(toCopy);
      this.queue[0] = buf;
    }
    return true;
  }
}
registerProcessor('pcm-player', PCMPlayer);
`;

type ChatItem = { role: "user" | "assistant"; text: string };

type ServerStatusValue = "gemini_open" | "gemini_closed" | "tool:google_search";
type ServerStatusMsg = { type: "status"; value: ServerStatusValue };
type ServerErrorMsg = { type: "error"; error: string };
type ServerAudioMsg = { type: "audio"; base64: string };
type ServerTextMsg = { type: "text"; text: string };
type ServerTurnDone = { type: "turnComplete" };

type ServerMsg =
  | ServerStatusMsg
  | ServerErrorMsg
  | ServerAudioMsg
  | ServerTextMsg
  | ServerTurnDone;

function isServerMsg(v: unknown): v is ServerMsg {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r.type === "status") return typeof r.value === "string";
  if (r.type === "error") return typeof r.error === "string";
  if (r.type === "audio") return typeof r.base64 === "string";
  if (r.type === "text") return typeof r.text === "string";
  if (r.type === "turnComplete") return true;
  return false;
}

type LanguageCode = "auto" | "en" | "hi" | "bn" | "ta" | "te" | "kn";
type LanguageOption = {
  code: LanguageCode;
  label: string;
  systemNudge: string;
};

const LANGUAGES: LanguageOption[] = [
  {
    code: "auto",
    label: "Auto",
    systemNudge: "Detect the user's language and reply in that language.",
  },
  { code: "en", label: "English", systemNudge: "Always reply in English." },
  {
    code: "hi",
    label: "Hindi (हिन्दी)",
    systemNudge: "Always reply in Hindi.",
  },
  {
    code: "bn",
    label: "Bengali (বাংলা)",
    systemNudge: "Always reply in Bengali.",
  },
  { code: "ta", label: "Tamil (தமிழ்)", systemNudge: "Always reply in Tamil." },
  {
    code: "te",
    label: "Telugu (తెలుగు)",
    systemNudge: "Always reply in Telugu.",
  },
  {
    code: "kn",
    label: "Kannada (ಕನ್ನಡ)",
    systemNudge: "Always reply in Kannada.",
  },
];

type Props = { wsUrl?: string };

export default function VoiceAssistantApp({ wsUrl }: Props) {
  const WS_URL: string =
    wsUrl ??
    (import.meta as { env: Record<string, string | undefined> }).env
      .VITE_WS_URL ??
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}${
      (import.meta as { env: Record<string, string | undefined> }).env.DEV
        ? ":3000"
        : location.port
        ? `:${location.port}`
        : ""
    }/ws/client`;

  const [connecting, setConnecting] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  const [speaking, setSpeaking] = useState<boolean>(false);
  const [micOn, setMicOn] = useState<boolean>(false);
  const [input, setInput] = useState<string>("");
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [levelIn, setLevelIn] = useState<number>(0);
  const [levelOut, setLevelOut] = useState<number>(0);

  const [lang, setLang] = useState<LanguageOption>(LANGUAGES[0]);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const playNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletLoadedRef = useRef<boolean>(false);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micNodeRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const speakingRef = useRef<boolean>(false);
  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  const lastBargeAtRef = useRef<number>(0);
  const ignoreAudioUntilRef = useRef<number>(0);

  async function ensurePlayback(): Promise<void> {
    if (ctxRef.current) return;

    try {
      if (typeof AudioContext !== "undefined") {
        ctxRef.current = new AudioContext({ sampleRate: 24000 });
      } else if (window.webkitAudioContext) {
        ctxRef.current = new window.webkitAudioContext({ sampleRate: 24000 });
      } else {
        throw new Error("AudioContext is not supported in this browser.");
      }
    } catch {
      if (typeof AudioContext !== "undefined") {
        ctxRef.current = new AudioContext();
      } else if (window.webkitAudioContext) {
        ctxRef.current = new window.webkitAudioContext();
      }
    }

    const ctx = ctxRef.current!;
    if (!workletLoadedRef.current) {
      const blob = new Blob([WORKLET_CODE], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      playNodeRef.current = new AudioWorkletNode(ctx, "pcm-player");
      playNodeRef.current.connect(ctx.destination);
      workletLoadedRef.current = true;
    }
  }

  function pushPlayback(f32: Float32Array): void {
    if (!playNodeRef.current) return;
    const v = rms(f32);
    setLevelOut((p) => p * 0.6 + v * 0.8);
    playNodeRef.current.port.postMessage(f32);
  }

  function flushPlayback(): void {
    if (playNodeRef.current) {
      playNodeRef.current.port.postMessage({ cmd: "flush" });
    }
  }

  function bargeIn(): void {
    const now = performance.now();
    if (now - lastBargeAtRef.current < 250) return; // debounce
    lastBargeAtRef.current = now;

    // Drop anything already queued to the speakers
    flushPlayback();

    // Ignore any late audio frames for a short window
    ignoreAudioUntilRef.current = now + 300;

    // Tell the server to cancel the current response
    wsRef.current?.send(JSON.stringify({ type: "barge" }));

    // Stop the speaking visual
    setSpeaking(false);
  }

  function appendChat(item: ChatItem): void {
    setChat((c) => [...c, item]);
  }

  async function startSession(): Promise<void> {
    setConnecting(true);
    await ensurePlayback();

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = (): void => {
      const system = [
        "You are a friendly Revolt Motors voice assistant.",
        lang.systemNudge,
        "If I speak a different language, translate my request but ALWAYS reply in the selected language.",
      ].join(" ");

      ws.send(
        JSON.stringify({
          type: "start",
          system,
          language: lang.code,
        })
      );
    };

    ws.onerror = (_e: Event): void => {
      console.error("WS error", _e);
      setConnecting(false);
    };

    ws.onclose = (): void => {
      setConnected(false);
      setConnecting(false);
      setSpeaking(false);
    };

    ws.onmessage = (ev: MessageEvent<string>): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!isServerMsg(parsed)) return;

      switch (parsed.type) {
        case "status":
          if (parsed.value === "gemini_open") {
            setConnected(true);
            setConnecting(false);
            if (lang.code !== "auto") {
              const display = lang.label.replace(/\s*\(.+\)\s*$/, "");
              ws.send(
                JSON.stringify({
                  type: "text",
                  text: `From now on, reply ONLY in ${display}. If I use another language, translate and answer in ${display}.`,
                })
              );
            }
          }
          break;

        case "error":
          console.error("Server error:", parsed.error);
          appendChat({ role: "assistant", text: `⚠️ ${parsed.error}` });
          break;

        case "text":
          appendChat({ role: "assistant", text: parsed.text });
          break;

        case "audio": {
          if (performance.now() < ignoreAudioUntilRef.current) break;
          const f32 = base64PCMtoFloat32(parsed.base64);
          setSpeaking(true);
          pushPlayback(f32);
          break;
        }

        case "turnComplete":
          window.setTimeout(() => setSpeaking(false), 250);
          break;
      }
    };
  }

  function stopSession(): void {
    setMicOn(false);
    stopMic();
    wsRef.current?.close();
  }

  async function startMic(): Promise<void> {
    try {
      if (micNodeRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
      });
      micStreamRef.current = stream;

      let micCtx: AudioContext | null = null;
      if (typeof AudioContext !== "undefined") {
        micCtx = new AudioContext();
      } else if (window.webkitAudioContext) {
        micCtx = new window.webkitAudioContext();
      }
      if (!micCtx) return;

      micCtxRef.current = micCtx;
      const source = micCtx.createMediaStreamSource(stream);
      const node = micCtx.createScriptProcessor(4096, 1, 1);
      micNodeRef.current = node;

      source.connect(node);
      node.connect(micCtx.destination);

      node.onaudioprocess = (e: AudioProcessingEvent): void => {
        const inBuf = e.inputBuffer.getChannelData(0);
        const v = rms(inBuf);
        setLevelIn((p) => p * 0.6 + v * 1.2);
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)
          return;
        const f16 = resampleFloat32(inBuf, micCtx!.sampleRate, 16000);
        const b64 = float32ToPCM16Base64(f16);
        wsRef.current.send(JSON.stringify({ type: "audio", base64: b64 }));
        if (speakingRef.current && v > 0.005) {
          bargeIn();
        }
      };
    } catch (err) {
      console.error("Mic error", err);
    }
  }

  function stopMic(): void {
    if (micNodeRef.current) {
      micNodeRef.current.disconnect();
      micNodeRef.current = null;
    }
    if (micCtxRef.current) {
      void micCtxRef.current.close();
      micCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current
        .getTracks()
        .forEach((t: MediaStreamTrack) => t.stop());
      micStreamRef.current = null;
    }
  }

  function toggleMic(): void {
    if (!connected) return;
    const next = !micOn;
    setMicOn(next);
    if (next) void startMic();
    else stopMic();
  }

  function sendText(): void {
    if (!connected || !input.trim()) return;

    let text = input.trim();
    if (lang.code !== "auto") {
      const display = lang.label.replace(/\s*\(.+\)\s*$/, "");
      text = `Please reply ONLY in ${display}. ${text}`;
    }

    appendChat({ role: "user", text: input });
    wsRef.current?.send(JSON.stringify({ type: "text", text }));
    setInput("");
  }

  useEffect(() => {
    return () => {
      stopMic();
      wsRef.current?.close();
      ctxRef.current?.close();
    };
  }, []);

  const activity: number = useMemo(
    () => Math.min(1, Math.pow(Math.max(levelIn, levelOut) * 2.2, 0.75)),
    [levelIn, levelOut]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-black text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-fuchsia-500 to-cyan-400 grid place-items-center shadow-lg shadow-fuchsia-500/30">
              <Zap size={20} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Revolt Voice Assistant
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 rounded-xl bg-slate-800/60 ring-1 ring-white/10 px-3 py-2 text-xs">
              <Globe size={16} />
              <select
                value={lang.code}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const next = LANGUAGES.find(
                    (l) => l.code === (e.target.value as LanguageCode)
                  );
                  if (next) setLang(next);
                }}
                className="bg-transparent focus:outline-none cursor-pointer text-slate-100"
                title="Language"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code} className="bg-slate-800">
                    {l.label}
                  </option>
                ))}
              </select>
            </label>

            {!connected ? (
              <button
                onClick={() => void startSession()}
                disabled={connecting}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/90 hover:bg-emerald-500 px-4 py-2 text-sm font-medium shadow-lg shadow-emerald-500/20"
              >
                {connecting ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Power size={16} />
                )}{" "}
                Connect
              </button>
            ) : (
              <button
                onClick={stopSession}
                className="inline-flex items-center gap-2 rounded-xl bg-red-500/90 hover:bg-red-500 px-4 py-2 text-sm font-medium shadow-lg shadow-red-500/20"
              >
                <CircleStop size={16} /> Disconnect
              </button>
            )}

            <button
              onClick={toggleMic}
              disabled={!connected}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow-lg ${
                micOn
                  ? "bg-cyan-500/90 hover:bg-cyan-500 shadow-cyan-500/20"
                  : "bg-slate-700/70 hover:bg-slate-700"
              } `}
            >
              {micOn ? <Mic size={16} /> : <MicOff size={16} />}{" "}
              {micOn ? "Mic On" : "Mic Off"}
            </button>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="relative rounded-3xl bg-slate-800/40 ring-1 ring-white/10 p-8 overflow-hidden">
            <motion.div
              className="absolute inset-0 -z-10"
              animate={{ opacity: speaking ? 0.6 : 0.35 }}
              transition={{ duration: 0.6 }}
              style={{
                background:
                  "radial-gradient(600px 320px at 30% 20%, rgba(56,189,248,0.2), transparent), radial-gradient(480px 260px at 70% 60%, rgba(217,70,239,0.18), transparent)",
              }}
            />
            <div className="flex items-center justify-center py-8">
              <BlobAvatar
                activity={activity}
                title={`Hi, I'm Revolt`}
                subtitle="an AI Assistant"
                sizeVmin={60}
              />
            </div>
            <div className="mt-6 text-center">
              <p className="text-sm text-slate-300/80">
                {connected
                  ? speaking
                    ? "Assistant is speaking…"
                    : micOn
                    ? "Listening… talk now"
                    : "Connected"
                  : "Disconnected"}
              </p>
            </div>
          </div>

          <div className="rounded-3xl bg-slate-800/40 ring-1 ring-white/10 p-6 flex flex-col">
            <div className="flex-1 overflow-y-auto pr-1 space-y-3">
              {chat.length === 0 && (
                <div className="text-sm text-slate-400">
                  Ask something about Revolt, or toggle the mic and start
                  talking. The assistant will reply with voice and a short
                  transcript (optional).
                </div>
              )}
              {chat.map((m, idx) => (
                <div
                  key={idx}
                  className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user"
                      ? "ml-auto bg-cyan-500/20 text-cyan-100"
                      : "bg-slate-700/60 text-slate-100"
                  }`}
                >
                  {m.text}
                </div>
              ))}
            </div>

            <div className="mt-4">
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setInput(e.target.value)
                  }
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter") sendText();
                  }}
                  className="flex-1 rounded-xl bg-slate-900/60 ring-1 ring-white/10 px-4 py-3 text-sm focus:outline-none focus:ring-cyan-400/40"
                  placeholder={
                    connected
                      ? "Type a message and press Enter…"
                      : "Connect to start…"
                  }
                  disabled={!connected}
                />
                <button
                  onClick={sendText}
                  disabled={!connected || !input.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-500/90 hover:bg-cyan-500 px-4 py-3 text-sm font-medium shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  <Send size={16} /> Send
                </button>
              </div>
              <div className="text-xs text-slate-400 mt-2">
                Mic streams at 16k PCM to the server; assistant audio plays at
                24k via an AudioWorklet.
              </div>
            </div>
          </div>
        </main>

        <footer className="mt-10 text-center text-xs text-slate-500/80">
          Built for the Revolt assignment · Low-latency voice, barge-in friendly
        </footer>
      </div>
    </div>
  );
}
