import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type { DocRef } from "./types/types.js";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export async function uploadDoc(ai: GoogleGenAI, relPath: string): Promise<DocRef> {
  const filePath = path.resolve(process.cwd(), relPath);
  const uploaded = await ai.files.upload({ file: filePath });

  const uploadedName =
    (uploaded as any)?.file?.name ??
    (uploaded as any)?.name;
  if (!uploadedName) throw new Error("Upload failed: missing file.name");

  let meta: any;
  try {
    meta = await (ai.files as any).get({ name: uploadedName });
  } catch {
    meta = await (ai.files as any).get(uploadedName);
  }

  for (let i = 0; i < 20 && meta?.state !== "ACTIVE"; i++) {
    await sleep(300);
    try {
      meta = await (ai.files as any).get({ name: uploadedName });
    } catch {
      meta = await (ai.files as any).get(uploadedName);
    }
  }

  const uri =
    meta?.uri ??
    (uploaded as any)?.file?.uri;
  if (!uri) throw new Error("Upload failed: missing file.uri");

  return {
    name: (meta?.name ?? uploadedName) as string,
    uri: uri as string,
    mimeType: (meta?.mimeType ?? "application/pdf") as string,
  };
}

function extractTextFromAny(resp: unknown): string {
  const r: any = resp;
  if (typeof r?.outputText === "string") return r.outputText;

  const parts: any[] =
    r?.candidates?.[0]?.content?.parts ??
    r?.response?.candidates?.[0]?.content?.parts ??
    [];

  return parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join(" ").trim();
}

export async function askWithDoc(opts: {
  ai: GoogleGenAI;
  doc: DocRef;
  question: string;
  languageHint?: string;
  model?: string;
}): Promise<string> {
  const { ai, doc, question, languageHint, model } = opts;

  const systemHint = [
    "Answer using only the attached document.",
    "If the document does not contain the answer, say you don't know based on the brochure.",
    languageHint ? `Reply ONLY in ${languageHint}.` : "",
  ].filter(Boolean).join(" ");

  const payload: any = {
    model: model ?? process.env.KB_TEXT_MODEL ?? "gemini-1.5-flash-002",
    input: [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: doc.uri, mimeType: doc.mimeType } },
          { text: `${systemHint}\n\nQuestion: ${question}` },
        ],
      },
    ],
    generationConfig: { responseMimeType: "text/plain", temperature: 0.4 },
    config:            { responseMimeType: "text/plain", temperature: 0.4 },
  };

  const anyAI = ai as any;
  let res: any;
  if (anyAI.responses?.generate) {
    res = await anyAI.responses.generate(payload);
  } else if (anyAI.models?.generate) {
    res = await anyAI.models.generate(payload);
  } else if (anyAI.models?.generateContent) {
    res = await anyAI.models.generateContent(payload);
  } else {
    throw new Error("No compatible generate method found on @google/genai instance");
  }

  return extractTextFromAny(res?.response ?? res);
}
