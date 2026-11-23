import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import type { Content, Part } from "@google/genai";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FAST_MODEL_NAME = "gemini-3.1-flash-lite";
const DEEP_MODEL_NAME = "gemini-4-hydrogen";
const PORT = Number(process.env.PORT) || 3000;

const BASE_TUTOR_INSTRUCTION = [
  "당신은 화면 공유 및 이미지 기반의 조용한 텍스트 AI 스터디 튜터입니다.",
  "사용자가 보낸 화면 캡처·첨부 이미지와 질문, 그리고 이전 대화 맥락을 바탕으로 정확하고 이해하기 쉽게 설명하세요.",
  "답변은 읽기 좋은 마크다운(제목, 목록, 강조, 표 등)으로 구성하세요.",
  "수학 기호나 공식은 반드시 LaTeX 문법을 사용해 인라인 수식은 $...$, 블록 수식은 $$...$$ 로 감싸서 출력하세요.",
  "코드 예시나 수정 코드는 반드시 언어 이름이 명시된 펜스 코드 블록(예: ```python, ```ts)으로 작성하세요.",
  "음성 대화를 전제로 하는 표현(예: '화면 읽어드릴게요', '말씀해주세요')은 피하고 조용히 읽을 수 있는 텍스트 학습 노트 형태로 작성하세요.",
].join("\n");

interface HistoryTurnInput {
  role: "user" | "model";
  text: string;
}

interface TutorRequestBody {
  message?: unknown;
  systemInstruction?: unknown;
  history?: unknown;
  imageBase64?: unknown;
  images?: unknown;
  responseMode?: unknown;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function sanitizeHistory(rawHistory: unknown): Content[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  const cleaned: HistoryTurnInput[] = [];
  for (const item of rawHistory.slice(-12)) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const text = (item as { text?: unknown }).text;
    if ((role === "user" || role === "model") && typeof text === "string") {
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        cleaned.push({ role, text: trimmed.slice(0, 12000) });
      }
    }
  }

  // Merge consecutive turns of the same role to keep a valid alternating turn sequence
  const contents: Content[] = [];
  for (const turn of cleaned) {
    const last = contents[contents.length - 1];
    if (last && last.role === turn.role && last.parts?.[0] && "text" in last.parts[0]) {
      last.parts[0].text = `${last.parts[0].text ?? ""}\n\n${turn.text}`;
    } else {
      contents.push({
        role: turn.role,
        parts: [{ text: turn.text }],
      });
    }
  }

  // History should start with user if non-empty
  while (contents.length > 0 && contents[0].role !== "user") {
    contents.shift();
  }

  return contents;
}

const MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024;
const MAX_IMAGES_PER_REQUEST = 6;

function extractImagePart(rawImage: unknown): Part | null {
  if (typeof rawImage !== "string" || rawImage.trim().length === 0) {
    return null;
  }

  const trimmed = rawImage.trim();
  const dataUrlMatch = /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,(.+)$/i.exec(trimmed);

  let mimeType = "image/jpeg";
  let base64Data = trimmed;

  if (dataUrlMatch) {
    const rawMime = dataUrlMatch[1].toLowerCase();
    mimeType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
    base64Data = dataUrlMatch[2];
  } else if (trimmed.startsWith("data:")) {
    throw new Error("지원하지 않는 이미지 형식입니다. (JPEG, PNG, WebP, GIF 지원)");
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
    throw new Error("유효하지 않은 이미지 데이터 형식입니다.");
  }

  if (base64Data.length > MAX_IMAGE_BASE64_LENGTH) {
    throw new Error("이미지 용량이 너무 큽니다. 더 작은 이미지를 사용해 주세요.");
  }

  return {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };
}

function collectImageParts(body: TutorRequestBody | undefined): Part[] {
  const parts: Part[] = [];

  if (Array.isArray(body?.images)) {
    for (const item of body.images.slice(0, MAX_IMAGES_PER_REQUEST)) {
      const part = extractImagePart(item);
      if (part) {
        parts.push(part);
      }
    }
  }

  if (parts.length === 0 && body?.imageBase64) {
    const legacyPart = extractImagePart(body.imageBase64);
    if (legacyPart) {
      parts.push(legacyPart);
    }
  }

  return parts;
}

function formatGeminiError(err: unknown, modelName: string): { status: number; message: string } {
  const errObj = err as { status?: number; code?: number; message?: string };
  const rawMessage = errObj?.message || "AI 응답을 생성하는 중 오류가 발생했습니다.";
  const status = typeof errObj?.status === "number" ? errObj.status : 500;

  if (rawMessage.includes("API_KEY_INVALID") || rawMessage.includes("PERMISSION_DENIED") || status === 403) {
    return {
      status: 403,
      message: "Gemini API 키가 유효하지 않거나 권한이 없습니다. Settings > Secrets 패널에서 GEMINI_API_KEY를 확인해 주세요.",
    };
  }
  if (rawMessage.includes("RESOURCE_EXHAUSTED") || status === 429) {
    return {
      status: 429,
      message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  if (rawMessage.includes("UNAVAILABLE") || rawMessage.includes("high demand") || status === 503) {
    return {
      status: 503,
      message: `현재 ${modelName} 모델의 서버 요청량이 일시적으로 많아 응답이 지연되고 있습니다. '빠른 답변' 모드로 전환하거나 잠시 후 다시 시도해 주세요.`,
    };
  }
  if (rawMessage.includes("NOT_FOUND") || status === 404) {
    return {
      status: 404,
      message: `요청한 모델(${modelName})을 찾을 수 없습니다. API 키 또는 모델 지원 여부를 확인해 주세요.`,
    };
  }
  return { status, message: rawMessage };
}

async function startServer(): Promise<void> {
  const app = express();

  app.use(express.json({ limit: "25mb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, fastModel: FAST_MODEL_NAME, deepModel: DEEP_MODEL_NAME });
  });

  app.post("/api/tutor", async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(500).json({
        error: "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다. Settings > Secrets 패널에서 API 키를 설정해 주세요.",
      });
      return;
    }

    const body = req.body as TutorRequestBody | undefined;
    const rawMessage = typeof body?.message === "string" ? body.message.trim() : "";

    let imageParts: Part[] = [];
    try {
      imageParts = collectImageParts(body);
    } catch (imgErr) {
      res.status(400).json({
        error: imgErr instanceof Error ? imgErr.message : "이미지 처리 중 오류가 발생했습니다.",
      });
      return;
    }

    if (!rawMessage && imageParts.length === 0) {
      res.status(400).json({ error: "질문 내용이나 이미지를 입력해 주세요." });
      return;
    }

    if (rawMessage.length > 15000) {
      res.status(400).json({ error: "질문 길이가 너무 깁니다. 15,000자 이하로 입력해 주세요." });
      return;
    }

    const customInstruction =
      typeof body?.systemInstruction === "string" ? body.systemInstruction.trim().slice(0, 4000) : "";

    const combinedSystemInstruction = customInstruction
      ? `${BASE_TUTOR_INSTRUCTION}\n\n[사용자 지정 학습 스타일]\n${customInstruction}`
      : BASE_TUTOR_INSTRUCTION;

    const historyContents = sanitizeHistory(body?.history);

    const promptText = rawMessage || "첨부한 이미지를 바탕으로 핵심 내용을 분석하고 설명해 주세요.";
    const currentParts: Part[] = [...imageParts, { text: promptText }];

    // Append current user turn (merge if history ended with user turn)
    const contents: Content[] = [...historyContents];
    const lastTurn = contents[contents.length - 1];
    if (lastTurn && lastTurn.role === "user" && lastTurn.parts) {
      lastTurn.parts.push(...currentParts);
    } else {
      contents.push({
        role: "user",
        parts: currentParts,
      });
    }

    const isDeepMode = body?.responseMode === "deep";
    const activeModel = isDeepMode ? DEEP_MODEL_NAME : FAST_MODEL_NAME;
    const thinkingLevel = isDeepMode ? ThinkingLevel.HIGH : ThinkingLevel.MINIMAL;

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");
    res.write(`data: ${JSON.stringify({ stage: "thinking" })}\n\n`);

    let clientClosed = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientClosed = true;
      }
    });

    try {
      const responseStream = await ai.models.generateContentStream({
        model: activeModel,
        contents,
        config: {
          systemInstruction: combinedSystemInstruction,
          thinkingConfig: {
            thinkingLevel,
          },
        },
      });

      let sentStreamingStage = false;
      for await (const chunk of responseStream) {
        if (clientClosed) break;
        const textChunk = chunk.text;
        if (textChunk) {
          if (!sentStreamingStage) {
            sentStreamingStage = true;
            res.write(`data: ${JSON.stringify({ stage: "streaming" })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ text: textChunk })}\n\n`);
        }
      }

      if (!clientClosed) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    } catch (err) {
      console.error("Gemini API error:", err);
      if (!clientClosed) {
        const formatted = formatGeminiError(err, activeModel);
        res.write(`data: ${JSON.stringify({ error: formatted.message })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/flow-summary", async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(500).json({ error: "API 키가 설정되어 있지 않습니다." });
      return;
    }

    const body = req.body as { question?: unknown; answer?: unknown; hadImage?: unknown } | undefined;
    const question = typeof body?.question === "string" ? body.question.trim().slice(0, 1500) : "";
    const answer = typeof body?.answer === "string" ? body.answer.trim().slice(0, 3500) : "";
    const hadImage = Boolean(body?.hadImage);

    if (!question && !answer) {
      res.status(400).json({ error: "요약할 대화 내용이 없습니다." });
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: FAST_MODEL_NAME,
        contents: [
          `사용자 질문: ${question || (hadImage ? "(첨부 이미지 질문)" : "(없음)")}`,
          `튜터 답변 발췌: ${answer}`,
        ].join("\n\n"),
        config: {
          systemInstruction:
            "사용자의 공부 대화 1턴을 학습 타임라인용으로 아주 간략하게 요약하세요. title은 공백 포함 16자 이내의 핵심 개념/주제명(명사형), note는 공백 포함 32자 이내의 한 줄 핵심 요약으로 작성하세요.",
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.MINIMAL,
          },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: "16자 이내의 간략한 공부 주제 제목 (예: 이차방정식 판별식)",
              },
              note: {
                type: Type.STRING,
                description: "32자 이내의 한 줄 핵심 요약",
              },
            },
            required: ["title", "note"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim()) as {
        title?: string;
        note?: string;
      };

      res.json({
        title: typeof parsed.title === "string" ? parsed.title.trim().slice(0, 40) : "",
        note: typeof parsed.note === "string" ? parsed.note.trim().slice(0, 80) : "",
      });
    } catch (err) {
      console.error("Flow summary error:", err);
      res.status(500).json({ error: "흐름 요약 생성에 실패했습니다." });
    }
  });

  app.post("/api/memo", async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(500).json({ error: "API 키가 설정되어 있지 않습니다." });
      return;
    }

    const body = req.body as
      | {
          question?: unknown;
          answer?: unknown;
          images?: unknown;
          history?: unknown;
        }
      | undefined;

    const question = typeof body?.question === "string" ? body.question.trim().slice(0, 2000) : "";
    const answer = typeof body?.answer === "string" ? body.answer.trim().slice(0, 6000) : "";

    let imageParts: Part[] = [];
    try {
      imageParts = collectImageParts({ images: body?.images });
    } catch (imgErr) {
      res.status(400).json({
        error: imgErr instanceof Error ? imgErr.message : "이미지 처리 중 오류가 발생했습니다.",
      });
      return;
    }

    if (!question && !answer && imageParts.length === 0) {
      res.status(400).json({ error: "메모화할 학습 내용이 없습니다." });
      return;
    }

    const historyContents = sanitizeHistory(body?.history);
    const textSections = [
      question ? `[사용자 요청]\n${question}` : "",
      answer ? `[튜터 설명 / 원문 내용]\n${answer}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const promptParts: Part[] = [
      ...imageParts,
      {
        text:
          textSections ||
          "첨부된 학습 자료의 핵심 내용을 암기하기 쉽게 메모화해 주세요.",
      },
    ];

    const contents: Content[] = [...historyContents];
    const lastTurn = contents[contents.length - 1];
    if (lastTurn && lastTurn.role === "user" && lastTurn.parts) {
      lastTurn.parts.push(...promptParts);
    } else {
      contents.push({
        role: "user",
        parts: promptParts,
      });
    }

    try {
      const response = await ai.models.generateContent({
        model: FAST_MODEL_NAME,
        contents,
        config: {
          systemInstruction: [
            "당신은 학습 자료를 노션·옵시디언·메모장에 바로 복사 붙여넣기 좋게 구조화하고 암기 포인트를 뽑아주는 AI 학습 비서입니다.",
            "사용자가 지정한 책 내용, 화면, 또는 설명을 바탕으로 불필요한 인사말 없이 핵심만 깔끔하게 메모화하세요.",
            "title은 18자 이내의 간략한 주제 제목으로 작성하세요.",
            "note는 32자 이내의 한 줄 요약으로 작성하세요.",
            "memoText는 바로 복사 붙여넣기 좋은 깔끔한 한국어 마크다운 메모로 작성하세요 (■ 핵심 요약, • 암기 포인트/키워드, 필요하다면 간단한 비교나 공식 포함).",
            "flashcards는 꼭 외워야 할 핵심 문답(front: 질문 또는 빈칸/키워드, back: 간결한 정답) 2~4개로 만드세요.",
          ].join("\n"),
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: "18자 이내의 간략한 메모 제목",
              },
              note: {
                type: Type.STRING,
                description: "32자 이내의 한 줄 핵심 요약",
              },
              memoText: {
                type: Type.STRING,
                description: "복사 붙여넣기용 구조화된 암기 메모 본문",
              },
              flashcards: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    front: {
                      type: Type.STRING,
                      description: "암기 질문 또는 핵심 키워드",
                    },
                    back: {
                      type: Type.STRING,
                      description: "간결한 정답 또는 설명",
                    },
                  },
                  required: ["front", "back"],
                },
              },
            },
            required: ["title", "note", "memoText", "flashcards"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim()) as {
        title?: string;
        note?: string;
        memoText?: string;
        flashcards?: Array<{ front?: string; back?: string }>;
      };

      const cleanFlashcards = Array.isArray(parsed.flashcards)
        ? parsed.flashcards
            .filter(
              (c) =>
                c &&
                typeof c.front === "string" &&
                typeof c.back === "string" &&
                c.front.trim().length > 0 &&
                c.back.trim().length > 0
            )
            .slice(0, 5)
            .map((c, idx) => ({
              id: `card-${Date.now()}-${idx}`,
              front: c.front!.trim(),
              back: c.back!.trim(),
            }))
        : [];

      res.json({
        title: typeof parsed.title === "string" ? parsed.title.trim().slice(0, 48) : "",
        note: typeof parsed.note === "string" ? parsed.note.trim().slice(0, 90) : "",
        memoText: typeof parsed.memoText === "string" ? parsed.memoText.trim() : "",
        flashcards: cleanFlashcards,
      });
    } catch (err) {
      console.error("Memo generation error:", err);
      res.status(500).json({ error: "메모·암기 자료 생성에 실패했습니다." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Study Tutor server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
