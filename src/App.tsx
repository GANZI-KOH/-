/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, ListOrdered, RotateCcw, SlidersHorizontal } from "lucide-react";
import { ChatPanel } from "./components/ChatPanel";
import { ScreenSharePanel } from "./components/ScreenSharePanel";
import { StudyFlowPanel } from "./components/StudyFlowPanel";
import { SystemPromptBar } from "./components/SystemPromptBar";
import { DEFAULT_SYSTEM_PROMPT } from "./types/tutor";
import type {
  ChatImageAttachment,
  ChatMessage,
  MemoFlashcard,
  PreviewSize,
  ResponseMode,
  ResponseStage,
  StudyFlowStep,
} from "./types/tutor";

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getTodayStorageKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `ai-study-tutor-flow-${yyyy}-${mm}-${dd}`;
}

function loadTodayFlow(): StudyFlowStep[] {
  try {
    const raw = window.localStorage.getItem(getTodayStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StudyFlowStep =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.messageId === "string" &&
        typeof item.title === "string" &&
        typeof item.createdAt === "number"
    );
  } catch {
    return [];
  }
}

function extractFallbackTitle(question: string, hadImage: boolean): string {
  const firstLine = question
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return hadImage ? "이미지 질문" : "학습 질문";
  }
  return firstLine.length > 22 ? `${firstLine.slice(0, 22)}…` : firstLine;
}

function extractFallbackNote(answer: string): string {
  const plain = answer
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#>*_~$]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!plain) return "";
  return plain.length > 38 ? `${plain.slice(0, 38)}…` : plain;
}

const MEMO_INTENT_REGEX =
  /메모화|메모로|메모\s*만들|메모\s*정리|암기\s*카드|암기할|암기용|암기\s*정리|외우기\s*쉽게|외울\s*수|노트화|요약\s*메모/i;

function isMemoCommand(text: string): boolean {
  return MEMO_INTENT_REGEX.test(text);
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [responseMode, setResponseMode] = useState<ResponseMode>("fast");

  // Collapsible System Prompt state
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);

  // Study Flow state
  const [studyFlow, setStudyFlow] = useState<StudyFlowStep[]>(() => loadTodayFlow());
  const [isFlowCollapsed, setIsFlowCollapsed] = useState(false);
  const [expandedMemoId, setExpandedMemoId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<{ messageId: string; nonce: number } | null>(
    null
  );

  // Screen Share state
  const [isSharing, setIsSharing] = useState(false);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  const [isScreenPanelHidden, setIsScreenPanelHidden] = useState(false);
  const [previewSize, setPreviewSize] = useState<PreviewSize>("standard");
  const [videoResolution, setVideoResolution] = useState<{ width: number; height: number } | null>(
    null
  );
  const [shareError, setShareError] = useState<string | null>(null);
  const [lastCaptureAt, setLastCaptureAt] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopScreenShare = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.onended = null;
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsSharing(false);
    setVideoResolution(null);
  }, []);

  const startScreenShare = useCallback(async () => {
    setShareError(null);

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
      setShareError("현재 브라우저 환경에서는 화면 공유(getDisplayMedia)를 지원하지 않습니다.");
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 30 },
        },
        audio: false,
      });

      // Clean up any previous stream
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) {
          t.onended = null;
          t.stop();
        }
      }

      streamRef.current = mediaStream;
      const [videoTrack] = mediaStream.getVideoTracks();
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.srcObject = mediaStream;
        await videoEl.play().catch(() => {
          // Autoplay promise can reject silently; metadata event handles resolution
        });
      }

      setIsSharing(true);
    } catch (err) {
      const errorName = err instanceof DOMException ? err.name : "";
      if (errorName === "NotAllowedError" || errorName === "AbortError") {
        setShareError("화면 공유가 취소되었거나 권한이 거부되었습니다.");
      } else {
        setShareError("화면 공유를 시작하는 중 오류가 발생했습니다. 권한 설정을 확인해 주세요.");
      }
    }
  }, [stopScreenShare]);

  // Keep video element synced with stream & update resolution metadata
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (isSharing && streamRef.current && videoEl.srcObject !== streamRef.current) {
      videoEl.srcObject = streamRef.current;
      void videoEl.play().catch(() => {});
    }

    const handleLoadedMetadata = () => {
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        setVideoResolution({ width: videoEl.videoWidth, height: videoEl.videoHeight });
      }
    };

    videoEl.addEventListener("loadedmetadata", handleLoadedMetadata);
    videoEl.addEventListener("resize", handleLoadedMetadata);
    return () => {
      videoEl.removeEventListener("loadedmetadata", handleLoadedMetadata);
      videoEl.removeEventListener("resize", handleLoadedMetadata);
    };
  }, [isSharing, isPreviewCollapsed, isScreenPanelHidden]);

  // Persist today's study flow in localStorage
  useEffect(() => {
    try {
      const readySteps = studyFlow.map((step) =>
        step.status === "pending" ? { ...step, status: "ready" as const } : step
      );
      window.localStorage.setItem(getTodayStorageKey(), JSON.stringify(readySteps));
    } catch {
      // Ignore storage quota errors
    }
  }, [studyFlow]);

  const activeMessageIds = useMemo(
    () => new Set(messages.map((m) => m.id)),
    [messages]
  );

  const memoStepsByMessageId = useMemo(() => {
    const map = new Map<string, StudyFlowStep>();
    for (const step of studyFlow) {
      map.set(step.messageId, step);
    }
    return map;
  }, [studyFlow]);

  // Cleanup stream & request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      stopScreenShare();
    };
  }, [stopScreenShare]);

  const captureCurrentScreenAsJpeg = useCallback((): string | undefined => {
    const videoEl = videoRef.current;
    if (!isSharing || !videoEl || videoEl.readyState < 2) {
      return undefined;
    }

    const srcWidth = videoEl.videoWidth;
    const srcHeight = videoEl.videoHeight;
    if (!srcWidth || !srcHeight) {
      return undefined;
    }

    // Fast mode uses 1152px @ 0.72 JPEG quality for much smaller payload & fewer vision tokens
    const maxWidth = responseMode === "fast" ? 1152 : 1600;
    const jpegQuality = responseMode === "fast" ? 0.72 : 0.85;
    const scale = srcWidth > maxWidth ? maxWidth / srcWidth : 1;
    const targetWidth = Math.round(srcWidth * scale);
    const targetHeight = Math.round(srcHeight * scale);

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight);
    const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
    setLastCaptureAt(Date.now());
    return dataUrl;
  }, [isSharing, responseMode]);

  const handleStopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m, idx) =>
        idx === prev.length - 1 && m.role === "model" && !m.completedAt
          ? { ...m, stage: "stopped", completedAt: Date.now() }
          : m
      )
    );
  }, []);

  const handleResetChat = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setMessages([]);
  }, []);

  const handleClearFlow = useCallback(() => {
    setStudyFlow([]);
    setExpandedMemoId(null);
    try {
      window.localStorage.removeItem(getTodayStorageKey());
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleSelectFlowStep = useCallback((messageId: string) => {
    setScrollTarget({ messageId, nonce: Date.now() });
  }, []);

  const handleToggleExpandMemo = useCallback((stepId: string) => {
    setExpandedMemoId((prev) => (prev === stepId ? null : stepId));
  }, []);

  const handleOpenMemoStep = useCallback((stepId: string) => {
    setIsFlowCollapsed(false);
    setExpandedMemoId(stepId);
  }, []);

  const handleToggleMemorized = useCallback((stepId: string) => {
    setStudyFlow((prev) =>
      prev.map((step) =>
        step.id === stepId && step.memoData
          ? {
              ...step,
              memoData: {
                ...step.memoData,
                memorized: !step.memoData.memorized,
              },
            }
          : step
      )
    );
  }, []);

  const enrichFlowStep = useCallback(
    async (stepId: string, question: string, answer: string, hadImage: boolean) => {
      const fallbackNote = extractFallbackNote(answer);
      setStudyFlow((prev) =>
        prev.map((step) =>
          step.id === stepId
            ? {
                ...step,
                note: fallbackNote || step.note,
                status: "ready",
              }
            : step
        )
      );

      try {
        const res = await fetch("/api/flow-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, answer, hadImage }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { title?: string; note?: string };
        const cleanTitle = typeof data.title === "string" ? data.title.trim() : "";
        const cleanNote = typeof data.note === "string" ? data.note.trim() : "";
        if (!cleanTitle && !cleanNote) return;

        setStudyFlow((prev) =>
          prev.map((step) =>
            step.id === stepId
              ? {
                  ...step,
                  title: cleanTitle || step.title,
                  note: cleanNote || step.note,
                  status: "ready",
                }
              : step
          )
        );
      } catch {
        // Keep local fallback silently
      }
    },
    []
  );

  const generateMemoForStep = useCallback(
    async (
      stepId: string,
      payload: {
        question: string;
        answer: string;
        images?: string[];
        history?: Array<{ role: "user" | "model"; text: string }>;
        autoExpand?: boolean;
      }
    ) => {
      try {
        const res = await fetch("/api/memo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: payload.question,
            answer: payload.answer,
            images: payload.images,
            history: payload.history,
          }),
        });

        if (!res.ok) {
          throw new Error("메모 생성 실패");
        }

        const data = (await res.json()) as {
          title?: string;
          note?: string;
          memoText?: string;
          flashcards?: MemoFlashcard[];
        };

        const cleanTitle = typeof data.title === "string" ? data.title.trim() : "";
        const cleanNote = typeof data.note === "string" ? data.note.trim() : "";
        const cleanMemoText =
          typeof data.memoText === "string" && data.memoText.trim()
            ? data.memoText.trim()
            : payload.answer || payload.question;
        const flashcards = Array.isArray(data.flashcards) ? data.flashcards : [];

        setStudyFlow((prev) =>
          prev.map((step) =>
            step.id === stepId
              ? {
                  ...step,
                  kind: "memo",
                  title: cleanTitle || step.title,
                  note: cleanNote || extractFallbackNote(cleanMemoText) || step.note,
                  status: "ready",
                  memoData: {
                    memoText: cleanMemoText,
                    flashcards,
                    memorized: step.memoData?.memorized ?? false,
                  },
                }
              : step
          )
        );

        if (payload.autoExpand) {
          setIsFlowCollapsed(false);
          setExpandedMemoId(stepId);
        }
      } catch {
        const fallbackMemo = payload.answer || payload.question || "정리된 메모 내용이 없습니다.";
        setStudyFlow((prev) =>
          prev.map((step) =>
            step.id === stepId
              ? {
                  ...step,
                  kind: "memo",
                  note: extractFallbackNote(fallbackMemo) || "원문 메모로 저장됨",
                  status: "ready",
                  memoData: {
                    memoText: fallbackMemo,
                    flashcards: [],
                    memorized: false,
                  },
                }
              : step
          )
        );
      }
    },
    []
  );

  const handleCreateMemoFromMessage = useCallback(
    (modelMessageId: string) => {
      const modelIdx = messages.findIndex((m) => m.id === modelMessageId);
      if (modelIdx === -1) return;

      const modelMsg = messages[modelIdx];
      const userMsg = modelIdx > 0 && messages[modelIdx - 1]?.role === "user"
        ? messages[modelIdx - 1]
        : undefined;

      const linkedMessageId = userMsg?.id ?? modelMsg.id;
      const questionText = userMsg?.text ?? "";
      const answerText = modelMsg.text ?? "";
      const images = userMsg?.attachments?.map((a) => a.dataUrl)
        ?? (userMsg?.imageDataUrl ? [userMsg.imageDataUrl] : undefined);
      const hadImage = Boolean(images && images.length > 0);

      const historySnapshot = messages
        .slice(0, Math.max(0, modelIdx - (userMsg ? 1 : 0)))
        .filter((m) => !m.error && m.text.trim().length > 0)
        .slice(-6)
        .map((m) => ({ role: m.role, text: m.text }));

      const existingStep = studyFlow.find((s) => s.messageId === linkedMessageId);
      const stepId = existingStep?.id ?? createId();

      if (existingStep) {
        setStudyFlow((prev) =>
          prev.map((s) =>
            s.id === stepId
              ? { ...s, kind: "memo", status: "pending", note: "암기·복사용 메모 정리 중..." }
              : s
          )
        );
      } else {
        const newStep: StudyFlowStep = {
          id: stepId,
          messageId: linkedMessageId,
          kind: "memo",
          title: extractFallbackTitle(questionText || answerText, hadImage),
          note: "암기·복사용 메모 정리 중...",
          createdAt: Date.now(),
          hadImage,
          status: "pending",
        };
        setStudyFlow((prev) => [...prev, newStep]);
      }

      setIsFlowCollapsed(false);
      setExpandedMemoId(stepId);

      void generateMemoForStep(stepId, {
        question: questionText,
        answer: answerText,
        images,
        history: historySnapshot,
        autoExpand: true,
      });
    },
    [generateMemoForStep, messages, studyFlow]
  );

  const handleSendMessage = useCallback(
    async (
      questionText: string,
      attachedImages: ChatImageAttachment[] = [],
      options?: { forceMemo?: boolean }
    ) => {
      if (isStreaming) return;

      const trimmedQuestion = questionText.trim();
      const capturedJpegDataUrl = captureCurrentScreenAsJpeg();

      const attachments: ChatImageAttachment[] = [];
      if (capturedJpegDataUrl) {
        attachments.push({
          id: createId(),
          dataUrl: capturedJpegDataUrl,
          source: "screen",
          name: "자동 캡처",
        });
      }
      if (attachedImages.length > 0) {
        attachments.push(...attachedImages);
      }

      if (!trimmedQuestion && attachments.length === 0) return;

      // Snapshot valid previous turns before adding the new turn
      const historyPayload = messages
        .filter(
          (m) =>
            !m.error &&
            (m.text.trim().length > 0 ||
              (m.attachments?.length ?? 0) > 0 ||
              Boolean(m.imageDataUrl))
        )
        .map((m) => ({
          role: m.role,
          text: m.text.trim().length > 0 ? m.text : "[이미지 첨부]",
        }));

      const userMsgId = createId();
      const modelMsgId = createId();
      const flowStepId = createId();
      const hadImage = attachments.length > 0;
      const isMemoRequest = Boolean(options?.forceMemo) || isMemoCommand(trimmedQuestion);

      const startedAt = Date.now();

      const userMessage: ChatMessage = {
        id: userMsgId,
        role: "user",
        text: trimmedQuestion,
        imageDataUrl: capturedJpegDataUrl,
        attachments: attachments.length > 0 ? attachments : undefined,
        createdAt: startedAt,
      };

      const placeholderModelMessage: ChatMessage = {
        id: modelMsgId,
        role: "model",
        text: "",
        createdAt: startedAt,
        startedAt,
        stage: "sending",
      };

      const initialFlowStep: StudyFlowStep = {
        id: flowStepId,
        messageId: userMsgId,
        kind: isMemoRequest ? "memo" : "qa",
        title: extractFallbackTitle(trimmedQuestion, hadImage),
        note: isMemoRequest ? "메모·암기 카드 정리 중..." : "답변 요약 중...",
        createdAt: startedAt,
        hadImage,
        status: "pending",
      };

      setMessages((prev) => [...prev, userMessage, placeholderModelMessage]);
      setStudyFlow((prev) => [...prev, initialFlowStep]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch("/api/tutor", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            message: trimmedQuestion,
            systemInstruction: systemPrompt,
            history: historyPayload,
            images: attachments.map((item) => item.dataUrl),
            responseMode,
          }),
        });

        const contentType = response.headers.get("content-type") || "";

        if (!response.ok || !contentType.includes("text/event-stream")) {
          const errJson = await response.json().catch(() => null);
          const errorMsg =
            errJson?.error || `서버 응답 오류가 발생했습니다 (HTTP ${response.status}).`;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === modelMsgId
                  ? { ...m, error: errorMsg, stage: "error", completedAt: Date.now() }
                  : m
              )
            );
            setStudyFlow((prev) => prev.filter((step) => step.id !== flowStepId));
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("응답 스트림을 읽을 수 없습니다.");
          }

          const decoder = new TextDecoder();
          let buffer = "";
          let streamFinishedWithError = false;
          let accumulatedAnswer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line.startsWith("data:")) continue;

              const payloadStr = line.slice(5).trim();
              if (!payloadStr) continue;

              let parsed: {
                text?: string;
                error?: string;
                done?: boolean;
                stage?: ResponseStage;
              };
              try {
                parsed = JSON.parse(payloadStr);
              } catch {
                continue;
              }

              if (parsed.error) {
                streamFinishedWithError = true;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === modelMsgId
                      ? {
                          ...m,
                          error: parsed.error,
                          stage: "error",
                          completedAt: Date.now(),
                        }
                      : m
                  )
                );
                setStudyFlow((prev) => prev.filter((step) => step.id !== flowStepId));
                return;
              }

              if (parsed.stage) {
                const nextStage = parsed.stage;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === modelMsgId
                      ? {
                          ...m,
                          stage: nextStage,
                          firstTokenAt:
                            nextStage === "streaming" && !m.firstTokenAt
                              ? Date.now()
                              : m.firstTokenAt,
                        }
                      : m
                  )
                );
              }

              if (parsed.text) {
                const chunkTime = Date.now();
                accumulatedAnswer += parsed.text;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === modelMsgId
                      ? {
                          ...m,
                          stage: "streaming",
                          firstTokenAt: m.firstTokenAt ?? chunkTime,
                          text: m.text + parsed.text,
                        }
                      : m
                  )
                );
              }

              if (parsed.done) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === modelMsgId
                      ? { ...m, stage: "done", completedAt: Date.now() }
                      : m
                  )
                );
              }
            }
          }

          if (!streamFinishedWithError) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === modelMsgId && !m.completedAt
                  ? { ...m, stage: "done", completedAt: Date.now() }
                  : m
              )
            );
            if (isMemoRequest) {
              void generateMemoForStep(flowStepId, {
                question: trimmedQuestion,
                answer: accumulatedAnswer,
                images: attachments.map((a) => a.dataUrl),
                history: historyPayload,
                autoExpand: true,
              });
            } else {
              void enrichFlowStep(flowStepId, trimmedQuestion, accumulatedAnswer, hadImage);
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === modelMsgId
                  ? {
                      ...m,
                      stage: "stopped",
                      completedAt: m.completedAt ?? Date.now(),
                      text: m.text || "_답변 생성이 중지되었습니다._",
                    }
                  : m
              )
            );
            setStudyFlow((prev) =>
              prev.map((step) =>
                step.id === flowStepId
                  ? { ...step, note: "답변 중지됨", status: "ready" }
                  : step
              )
            );
            return;
          }

          const fallbackError =
            err instanceof Error
              ? err.message
              : "네트워크 연결 중 오류가 발생했습니다.";

          setMessages((prev) =>
            prev.map((m) =>
              m.id === modelMsgId
                ? {
                    ...m,
                    error: fallbackError,
                    stage: "error",
                    completedAt: Date.now(),
                  }
                : m
            )
          );
          setStudyFlow((prev) => prev.filter((step) => step.id !== flowStepId));
        } finally {
          abortControllerRef.current = null;
          setIsStreaming(false);
        }
      },
      [
        captureCurrentScreenAsJpeg,
        enrichFlowStep,
        generateMemoForStep,
        isStreaming,
        messages,
        responseMode,
        systemPrompt,
      ]
    );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900">
      {/* Top Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <h1 className="whitespace-nowrap text-base font-bold tracking-tight text-slate-900 sm:text-lg">
            AI 스터디 튜터
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsScreenPanelHidden((prev) => !prev)}
            aria-pressed={!isScreenPanelHidden}
            className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
              isScreenPanelHidden
                ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                : "border-sky-200 bg-sky-50 text-sky-800"
            }`}
          >
            {isScreenPanelHidden ? (
              <Eye className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="hidden sm:inline">
              {isScreenPanelHidden ? "공유 화면 보기" : "공유 화면 생략"}
            </span>
            <span className="sm:hidden">{isScreenPanelHidden ? "화면 보기" : "화면 생략"}</span>
            {isSharing && isScreenPanelHidden && (
              <span
                aria-label="화면 공유 중"
                className="h-2 w-2 rounded-full bg-emerald-600"
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsFlowCollapsed((prev) => !prev)}
            aria-expanded={!isFlowCollapsed}
            className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
              !isFlowCollapsed
                ? "border-sky-200 bg-sky-50 text-sky-800"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <ListOrdered className="h-3.5 w-3.5 shrink-0" />
            <span>공부 흐름</span>
            {studyFlow.length > 0 && (
              <span className="font-mono text-[11px] tabular-nums opacity-80">
                {studyFlow.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsPromptOpen((prev) => !prev)}
            aria-expanded={isPromptOpen}
            className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
              isPromptOpen
                ? "border-sky-200 bg-sky-50 text-sky-800"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">학습 스타일 설정</span>
            <span className="sm:hidden">스타일</span>
          </button>

          <button
            type="button"
            onClick={handleResetChat}
            disabled={messages.length === 0 && !isStreaming}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sky-600"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">대화 초기화</span>
            <span className="sm:hidden">초기화</span>
          </button>
        </div>
      </header>

      {/* Collapsible System Prompt Panel */}
      <SystemPromptBar
        isOpen={isPromptOpen}
        systemPrompt={systemPrompt}
        onChangePrompt={setSystemPrompt}
        onClose={() => setIsPromptOpen(false)}
      />

      {/* Main Study Workspace: Optional Screen Share + Today's Study Flow + Chat */}
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <ScreenSharePanel
          isSharing={isSharing}
          isCollapsed={isPreviewCollapsed}
          isHidden={isScreenPanelHidden}
          previewSize={previewSize}
          videoResolution={videoResolution}
          shareError={shareError}
          lastCaptureAt={lastCaptureAt}
          videoRef={videoRef}
          onStartShare={startScreenShare}
          onStopShare={stopScreenShare}
          onToggleCollapse={() => setIsPreviewCollapsed((prev) => !prev)}
          onHidePanel={() => setIsScreenPanelHidden(true)}
          onChangeSize={setPreviewSize}
          onDismissError={() => setShareError(null)}
        />

        <StudyFlowPanel
          steps={studyFlow}
          activeMessageIds={activeMessageIds}
          isCollapsed={isFlowCollapsed}
          expandedMemoId={expandedMemoId}
          onToggleExpandMemo={handleToggleExpandMemo}
          onToggleMemorized={handleToggleMemorized}
          onToggleCollapse={() => setIsFlowCollapsed((prev) => !prev)}
          onSelectStep={handleSelectFlowStep}
          onClearFlow={handleClearFlow}
        />

        <ChatPanel
          messages={messages}
          isStreaming={isStreaming}
          isSharing={isSharing}
          responseMode={responseMode}
          scrollTarget={scrollTarget}
          memoStepsByMessageId={memoStepsByMessageId}
          onChangeResponseMode={setResponseMode}
          onSendMessage={handleSendMessage}
          onCreateMemoFromMessage={handleCreateMemoFromMessage}
          onOpenMemoStep={handleOpenMemoStep}
          onStopStreaming={handleStopStreaming}
          onStartShare={startScreenShare}
        />
      </main>
    </div>
  );
}
