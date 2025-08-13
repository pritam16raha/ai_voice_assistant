export type LanguageCode = "auto" | "en" | "hi" | "bn" | "ta" | "te" | "kn";

export const CODE_TO_NAME: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
};

export type ClientMsg =
  | {
      type: "start";
      system?: string;
      voice?: string;
      enableSearch?: boolean;
      language?: LanguageCode;
    }
  | { type: "audio"; base64: string }
  | { type: "text"; text: string; language?: LanguageCode }
  | { type: "stop" }
  | { type: "barge" };

export type ServerStatusValue =
  | "gemini_open"
  | "gemini_closed"
  | "tool:google_search";
export type ServerMsg =
  | { type: "status"; value: ServerStatusValue }
  | { type: "error"; error: string }
  | { type: "audio"; base64: string }
  | { type: "text"; text: string }
  | { type: "turnComplete" };

export type DocRef = {
  name: string;
  uri: string;
  mimeType: string;
};
