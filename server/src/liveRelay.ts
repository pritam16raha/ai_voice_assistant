import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { GoogleGenAI, Modality } from "@google/genai";

type ClientMsg =
  | { type: "start"; system?: string; voice?: string }
  | { type: "audio"; base64: string }
  | { type: "text"; text: string }
  | { type: "stop" };

type ServerMsg =
  | { type: "status"; value: string }
  | { type: "error"; error: string }
  | { type: "audio"; base64: string }
  | { type: "turnComplete" };

type LiveSession = {
  close: () => Promise<void>;
  send: (msg: unknown) => void;
  sendRealtimeInput: (msg: unknown) => void;
};

export function attachLiveRelay(
  server: HttpServer,
  model: string,
  apiKey: string
) {
  const wss = new WebSocketServer({ server, path: "/ws/client" });

  wss.on("connection", async (client: WebSocket) => {
    const ai = new GoogleGenAI({ apiKey });

    // let session: LiveSession | null = null;
    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    const send = (msg: ServerMsg) => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify(msg));
      }
    };

    client.on("message", async (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send({ type: "error", error: "Invalid JSON" });
        return;
      }

      if (msg.type === "start") {
        try {
          if (session) {
            try {
              await session.close();
            } catch {}
            session = null;
          }

          session = await ai.live.connect({
            model: process.env.GEMINI_MODEL || model,
            config: {
              responseModalities: [Modality.AUDIO],
              systemInstruction: msg.system ?? "You are a helpful assistant.",
            },
            callbacks: {
              onopen: () => send({ type: "status", value: "gemini_open" }),
              onmessage: (m: any) => {
                if (m?.data) {
                  send({ type: "audio", base64: m.data });
                }
                if (m?.serverContent?.turnComplete) {
                  send({ type: "turnComplete" });
                }
              },
              onerror: (e: any) => {
                send({ type: "error", error: e?.message || "gemini_error" });
              },
              onclose: () => send({ type: "status", value: "gemini_closed" }),
            },
          });
        } catch (e: any) {
          send({
            type: "error",
            error: e?.message || "Failed to open session",
          });
        }
        return;
      }

      if (!session) {
        send({
          type: "error",
          error: 'Session not started. Send {type:"start"} first.',
        });
        return;
      }

      if (msg.type === "audio") {
        try {
          session.sendRealtimeInput({
            audio: {
              data: msg.base64,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } catch (e: any) {
          send({ type: "error", error: e?.message || "audio send failed" });
        }
        return;
      }

      if (msg.type === "text") {
        try {
          if (typeof (session as any).send === "function") {
            (session as any).send({
              clientContent: [{ role: "user", parts: [{ text: msg.text }] }],
            });
          } else if (typeof (session as any).sendRealtimeInput === "function") {
            (session as any).sendRealtimeInput({ text: msg.text });
          } else {
            throw new Error("Live session has no send* method");
          }
        } catch (e: any) {
          send({ type: "error", error: e?.message || "text send failed" });
        }
        return;
      }

      if (msg.type === "stop") {
        return;
      }
    });

    client.on("close", async () => {
      try {
        await session?.close();
      } catch {}
    });
  });

  console.log("🔌 Live relay attached at /ws/client");
}
