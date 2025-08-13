import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { GoogleGenAI, Modality } from "@google/genai";

import { uploadDoc, askWithDoc } from "./doc.js";
import type {
  ClientMsg,
  ServerMsg,
  LanguageCode,
  DocRef,
} from "./types/types.js";
import { CODE_TO_NAME } from "./types/types.js";

const isText = (
  v: unknown
): v is { type: "text"; text: string; language?: LanguageCode } =>
  typeof v === "object" &&
  v !== null &&
  (v as any).type === "text" &&
  typeof (v as any).text === "string";

export function attachLiveRelay(
  server: HttpServer,
  model: string,
  apiKey: string
) {
  const wss = new WebSocketServer({ server, path: "/ws/client" });
  const aiRoot = new GoogleGenAI({ apiKey });

  const ENABLE_DOC = (process.env.ENABLE_DOC ?? "1") !== "0";
  const DOC_PATH = process.env.DOC_PATH ?? "data/revolt.pdf";
  const brochurePromise: Promise<DocRef> | null = ENABLE_DOC
    ? uploadDoc(aiRoot, DOC_PATH).catch((err) => {
        console.error("[doc] upload failed:", err);
        return Promise.reject(err);
      })
    : null;

  if (ENABLE_DOC) {
    brochurePromise
      ?.then((d) => console.log(`📄 Brochure ready: ${d.name}`))
      .catch(() => console.log("📄 Brochure not attached (upload failed)."));
  }

  wss.on("connection", async (client: WebSocket) => {
    let session: Awaited<ReturnType<typeof aiRoot.live.connect>> | null = null;

    const send = (msg: ServerMsg) => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(msg));
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

          session = await aiRoot.live.connect({
            model: process.env.GEMINI_MODEL || model,
            config: {
              responseModalities: [Modality.AUDIO],
              systemInstruction: msg.system ?? "You are a helpful assistant.",
              generationConfig: {
                temperature: 0.7,
                topP: 0.9,
              } as any,
            },
            callbacks: {
              onopen: () => send({ type: "status", value: "gemini_open" }),
              onmessage: (m: any) => {
                if (m?.data) send({ type: "audio", base64: m.data });
                if (typeof m?.text === "string" && m.text) {
                  send({ type: "text", text: m.text });
                }
                if (m?.serverContent?.turnComplete) {
                  send({ type: "turnComplete" });
                }
              },
              onerror: (e: any) =>
                send({ type: "error", error: e?.message || "gemini_error" }),
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
          (session as any).sendRealtimeInput({
            audio: { data: msg.base64, mimeType: "audio/pcm;rate=16000" },
          });
        } catch (e: any) {
          send({ type: "error", error: e?.message || "audio send failed" });
        }
        return;
      }

      if (isText(msg)) {
        try {
          const languageName =
            msg.language && msg.language !== "auto"
              ? CODE_TO_NAME[msg.language] ?? undefined
              : undefined;

          if (ENABLE_DOC && brochurePromise) {
            let answer = "";
            try {
              const doc = await brochurePromise;
              answer = await askWithDoc({
                ai: aiRoot,
                doc,
                question: msg.text,
                languageHint: languageName,
                model: process.env.KB_TEXT_MODEL,
              });

              if (answer) send({ type: "text", text: answer });

              if ((session as any).send) {
                (session as any).send({
                  serverContent: [
                    {
                      role: "tool",
                      parts: [
                        {
                          text: `Tool result (brochure QA): ${
                            answer || "(no answer found)"
                          } `,
                        },
                      ],
                    },
                  ],
                  clientContent: [
                    {
                      role: "user",
                      parts: [
                        {
                          text: "Please read the tool result for the user in one or two sentences.",
                        },
                      ],
                    },
                  ],
                });
              } else if ((session as any).sendRealtimeInput) {
                (session as any).sendRealtimeInput({
                  text: answer || "I couldn't find this in the brochure.",
                });
              }
            } catch (err: any) {
              (session as any).sendRealtimeInput({ text: msg.text });
            }
          } else {
            (session as any).sendRealtimeInput({ text: msg.text });
          }
        } catch (e: any) {
          send({ type: "error", error: e?.message || "text send failed" });
        }
        return;
      }

      if (msg.type === "stop") {
        return;
      }

      if (msg.type === "barge") {
        try {
          const s: any = session;
          if (typeof s?.send === "function") {
            s.send({ serverAction: "response.cancel" });
          } else if (typeof s?.sendRealtimeInput === "function") {
            s.sendRealtimeInput({ action: "response.cancel" });
          }
          send({ type: "status", value: "gemini_closed" });
        } catch (e: any) {
          send({ type: "error", error: e?.message ?? "barge cancel failed" });
        }
        return;
      }
    });

    client.on("close", async () => {
      try {
        await session?.close();
      } catch {}
    });
  });

  console.log("🔌 Live relay with Google Search enabled at /ws/client");
}
