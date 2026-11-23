import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  BookmarkCheck,
  BookmarkPlus,
  Camera,
  Check,
  Copy,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Maximize2,
  Monitor,
  Send,
  Square,
  X,
} from "lucide-react";
import type {
  ChatImageAttachment,
  ChatMessage,
  ResponseMode,
  ResponseStage,
  StudyFlowStep,
} from "../types/tutor";
import { processImageFile } from "../utils/image";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  isSharing: boolean;
  responseMode: ResponseMode;
  scrollTarget?: { messageId: string; nonce: number } | null;
  memoStepsByMessageId?: Map<string, StudyFlowStep>;
  onChangeResponseMode: (mode: ResponseMode) => void;
  onSendMessage: (
    text: string,
    attachedImages?: ChatImageAttachment[],
    options?: { forceMemo?: boolean }
  ) => void;
  onCreateMemoFromMessage: (modelMessageId: string) => void;
  onOpenMemoStep: (stepId: string) => void;
  onStopStreaming: () => void;
  onStartShare: () => void;
}

const MAX_ATTACHED_IMAGES = 5;

const STARTER_PROMPTS = [
  "지금 화면에 보이는 내용에서 핵심 개념 3가지만 쉽게 정리해줘.",
  "화면 속 문제의 풀이 과정을 단계별로 자세히 설명해줘.",
  "책에 나온 이 부분을 나중에 외우기 쉽게 메모화 해줘.",
];

function formatSeconds(ms: number): string {
  return `${Math.max(0, ms / 1000).toFixed(1)}초`;
}

function getStageLabel(stage?: ResponseStage): string {
  switch (stage) {
    case "sending":
      return "이미지 및 질문 전송 중";
    case "thinking":
      return "이미지와 질문을 분석하는 중";
    case "streaming":
      return "답변 작성 중";
    case "stopped":
      return "중지됨";
    case "error":
      return "오류 발생";
    case "done":
    default:
      return "답변 완료";
  }
}

function extractImageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];

  const files: File[] = [];
  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }

  if (files.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
    for (const file of Array.from(dataTransfer.files)) {
      if (file.type.startsWith("image/")) {
        files.push(file);
      }
    }
  }

  return files;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  isStreaming,
  isSharing,
  responseMode,
  scrollTarget,
  memoStepsByMessageId,
  onChangeResponseMode,
  onSendMessage,
  onCreateMemoFromMessage,
  onOpenMemoStep,
  onStopStreaming,
  onStartShare,
}) => {
  const [input, setInput] = useState("");
  const [isMemoMode, setIsMemoMode] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ChatImageAttachment[]>([]);
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (!isStreaming) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 100);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!scrollTarget?.messageId) return;
    const targetEl = document.getElementById(`chat-msg-${scrollTarget.messageId}`);
    if (!targetEl) return;
    targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(scrollTarget.messageId);
    const timer = window.setTimeout(() => {
      setHighlightedId((prev) => (prev === scrollTarget.messageId ? null : prev));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [scrollTarget]);

  useEffect(() => {
    if (!lightboxImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxImage(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxImage]);

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  const addImageFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      setAttachmentError(null);
      const remainingSlots = MAX_ATTACHED_IMAGES - attachedImages.length;

      if (remainingSlots <= 0) {
        setAttachmentError(`한 번에 최대 ${MAX_ATTACHED_IMAGES}장까지 이미지를 첨부할 수 있습니다.`);
        return;
      }

      const filesToProcess = imageFiles.slice(0, remainingSlots);
      if (imageFiles.length > remainingSlots) {
        setAttachmentError(
          `최대 ${MAX_ATTACHED_IMAGES}장 제한으로 ${filesToProcess.length}장만 첨부되었습니다.`
        );
      }

      setIsProcessingImages(true);
      try {
        const maxDimension = responseMode === "fast" ? 1280 : 1600;
        const processed = await Promise.all(
          filesToProcess.map((file) => processImageFile(file, maxDimension))
        );
        setAttachedImages((prev) => [...prev, ...processed].slice(0, MAX_ATTACHED_IMAGES));
      } catch (err) {
        setAttachmentError(
          err instanceof Error ? err.message : "이미지를 불러오는 중 오류가 발생했습니다."
        );
      } finally {
        setIsProcessingImages(false);
      }
    },
    [attachedImages.length, responseMode]
  );

  // Allow Ctrl+V image pasting anywhere on the page unless focused on another text input
  useEffect(() => {
    const handleWindowPaste = (e: ClipboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl === textareaRef.current) {
        return; // Handled by textarea's onPaste
      }
      if (
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl instanceof HTMLInputElement && activeEl.type !== "file")
      ) {
        return;
      }

      const imageFiles = extractImageFilesFromDataTransfer(e.clipboardData);
      if (imageFiles.length === 0) return;

      e.preventDefault();
      void addImageFiles(imageFiles);
      textareaRef.current?.focus();
    };

    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, [addImageFiles]);

  const handleRemoveAttachment = (id: string) => {
    setAttachedImages((prev) => prev.filter((item) => item.id !== id));
    setAttachmentError(null);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (isStreaming || isProcessingImages) return;
    if (!trimmed && attachedImages.length === 0 && !(isMemoMode && isSharing)) return;

    const currentAttachments = attachedImages;
    const forceMemo = isMemoMode;
    const promptText =
      trimmed ||
      (forceMemo ? "이 자료의 핵심 내용을 외우기 쉽게 메모화 해줘." : "");

    onSendMessage(promptText, currentAttachments, { forceMemo });
    setInput("");
    setAttachedImages([]);
    setAttachmentError(null);
    setIsMemoMode(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Google AI Studio style: Ctrl+Enter (or Cmd+Enter on macOS) sends; Enter inserts newline
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextareaPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = extractImageFilesFromDataTransfer(e.clipboardData);
    if (imageFiles.length === 0) return;

    const plainText = e.clipboardData.getData("text/plain").trim();
    const isJustFilename = imageFiles.some((file) => file.name && plainText === file.name);
    if (!plainText || isJustFilename) {
      e.preventDefault();
    }
    void addImageFiles(imageFiles);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      void addImageFiles(files);
    }
    e.target.value = "";
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingOver(false);

    const imageFiles = extractImageFilesFromDataTransfer(e.dataTransfer);
    if (imageFiles.length > 0) {
      void addImageFiles(imageFiles);
      textareaRef.current?.focus();
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setAttachmentError("이미지 파일(PNG, JPG, WebP, GIF)만 첨부할 수 있습니다.");
    }
  };

  const handleCopyAnswer = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      // Clipboard API unavailable
    }
  };

  const canSend =
    !isStreaming &&
    !isProcessingImages &&
    (input.trim().length > 0 || attachedImages.length > 0 || (isMemoMode && isSharing));

  return (
    <section
      aria-label="AI 튜터 텍스트 채팅"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex min-w-0 flex-1 flex-col bg-slate-50"
    >
      {/* Drag-and-drop overlay */}
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-sky-500 bg-sky-50/90 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 text-sky-800">
            <ImagePlus className="h-8 w-8 text-sky-600" />
            <p className="text-sm font-semibold">여기에 이미지를 놓아 첨부하세요</p>
            <p className="text-xs text-sky-700">PNG, JPG, WebP, GIF 지원 (최대 {MAX_ATTACHED_IMAGES}장)</p>
          </div>
        </div>
      )}

      {/* Message List */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-8"
      >
        <div className="mx-auto flex w-full max-w-[780px] flex-col gap-6">
          {messages.length === 0 ? (
            <div className="my-auto rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
              <div className="flex items-center gap-2.5 text-slate-900">
                <BookOpen className="h-5 w-5 text-sky-600" />
                <h2 className="text-base font-semibold">조용한 화면 공유 스터디 공간</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                왼쪽 패널에서 공부할 화면을 공유하거나 채팅창에 사진·스크린샷을 붙여넣어(Ctrl+V)
                질문해 보세요. 음성 없이 깔끔한 마크다운, 코드 블록, 수학 공식으로 답변합니다.
              </p>

              <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 text-xs text-slate-600 sm:grid-cols-3">
                <div>
                  <div className="font-semibold text-slate-900">01. 화면 공유 · 사진 첨부</div>
                  <p className="mt-1 leading-relaxed text-slate-500">
                    화면을 공유하거나 Ctrl+V / 이미지 버튼으로 문제 사진을 첨부하세요.
                  </p>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">02. 질문 전송</div>
                  <p className="mt-1 leading-relaxed text-slate-500">
                    Ctrl+Enter로 전송하며, Enter는 줄바꿈으로 동작합니다.
                  </p>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">03. 연속 학습</div>
                  <p className="mt-1 leading-relaxed text-slate-500">
                    이전 맥락이 유지되므로 꼬리 질문을 자유롭게 이어갈 수 있습니다.
                  </p>
                </div>
              </div>

              <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="text-xs font-medium text-slate-500">추천 질문 예시</div>
                <div className="mt-2.5 flex flex-col gap-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => {
                        setInput(prompt);
                        textareaRef.current?.focus();
                      }}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-left text-xs font-medium text-slate-700 transition-colors hover:border-sky-300 hover:bg-sky-50/60 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isLastModelStreaming =
                isStreaming && msg.role === "model" && idx === messages.length - 1;

              if (msg.role === "user") {
                const msgImages: ChatImageAttachment[] =
                  msg.attachments && msg.attachments.length > 0
                    ? msg.attachments
                    : msg.imageDataUrl
                      ? [
                          {
                            id: `${msg.id}-legacy`,
                            dataUrl: msg.imageDataUrl,
                            source: "screen",
                            name: "자동 캡처",
                          },
                        ]
                      : [];

                return (
                  <div
                    key={msg.id}
                    id={`chat-msg-${msg.id}`}
                    className={`flex flex-col items-end gap-2 rounded-2xl transition-shadow duration-300 ${
                      highlightedId === msg.id ? "ring-2 ring-sky-400/70 ring-offset-4 ring-offset-slate-50" : ""
                    }`}
                  >
                    {msgImages.length > 0 && (
                      <div className="flex max-w-full flex-wrap justify-end gap-2">
                        {msgImages.map((img) => {
                          const isScreenCapture = img.source === "screen";
                          return (
                            <button
                              key={img.id}
                              type="button"
                              onClick={() => setLightboxImage(img.dataUrl)}
                              className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white transition-transform hover:scale-[1.01] focus-visible:outline-2 focus-visible:outline-sky-600"
                              title="이미지 크게 보기"
                            >
                              <img
                                src={img.dataUrl}
                                alt={isScreenCapture ? "자동 캡처 화면" : img.name || "첨부 이미지"}
                                className="max-h-40 max-w-[260px] object-contain"
                              />
                              <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                                <span className="inline-flex items-center gap-1">
                                  {isScreenCapture ? (
                                    <Camera className="h-3 w-3" />
                                  ) : (
                                    <ImageIcon className="h-3 w-3" />
                                  )}
                                  <span>{isScreenCapture ? "자동 캡처" : "첨부 이미지"}</span>
                                </span>
                                <span className="inline-flex items-center gap-1 text-slate-600 group-hover:text-sky-600">
                                  <Maximize2 className="h-3 w-3" />
                                  <span>확대</span>
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {msg.text.trim().length > 0 && (
                      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-3 text-sm leading-relaxed text-white whitespace-pre-wrap">
                        {msg.text}
                      </div>
                    )}
                  </div>
                );
              }

              const isActiveTurn = isLastModelStreaming;
              const startedAt = msg.startedAt ?? msg.createdAt;
              const endTime = msg.completedAt ?? (isActiveTurn ? nowMs : msg.createdAt);
              const elapsedMs = Math.max(0, endTime - startedAt);
              const ttftMs =
                msg.firstTokenAt !== undefined ? Math.max(0, msg.firstTokenAt - startedAt) : null;
              const stageLabel = getStageLabel(msg.stage);

              return (
                <article
                  key={msg.id}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-4 sm:px-6 sm:py-5"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-slate-800">AI 스터디 튜터</span>

                      {isActiveTurn ? (
                        <>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="inline-flex items-center gap-1.5 font-medium text-sky-700">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>{stageLabel}</span>
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="font-mono text-slate-600 tabular-nums">
                            {formatSeconds(elapsedMs)} 경과
                          </span>
                          {ttftMs !== null && (
                            <>
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                              <span className="font-mono text-slate-500 tabular-nums">
                                첫 응답 {formatSeconds(ttftMs)}
                              </span>
                            </>
                          )}
                        </>
                      ) : msg.startedAt !== undefined ? (
                        <>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="text-slate-500">{stageLabel}</span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            총 {formatSeconds(elapsedMs)}
                            {ttftMs !== null ? ` (첫 응답 ${formatSeconds(ttftMs)})` : ""}
                          </span>
                        </>
                      ) : null}
                    </div>

                    {msg.text && !isLastModelStreaming && (
                      <div className="flex items-center gap-1.5">
                        {(() => {
                          const linkedUserMsg = idx > 0 ? messages[idx - 1] : undefined;
                          const existingMemo = linkedUserMsg
                            ? memoStepsByMessageId?.get(linkedUserMsg.id)
                            : undefined;
                          const isMemoPending = existingMemo?.status === "pending";
                          const hasReadyMemo =
                            existingMemo?.kind === "memo" && existingMemo.status === "ready";

                          if (isMemoPending) {
                            return (
                              <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-sky-700">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>메모 정리 중</span>
                              </span>
                            );
                          }

                          if (hasReadyMemo && existingMemo) {
                            return (
                              <button
                                type="button"
                                onClick={() => onOpenMemoStep(existingMemo.id)}
                                title="오늘 공부한 흐름에서 메모 열기"
                                className="inline-flex items-center gap-1 rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-sky-600"
                              >
                                <BookmarkCheck className="h-3.5 w-3.5" />
                                <span>메모됨</span>
                              </button>
                            );
                          }

                          return (
                            <button
                              type="button"
                              onClick={() => onCreateMemoFromMessage(msg.id)}
                              title="이 설명을 암기용 메모로 정리해 공부 흐름에 추가"
                              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:bg-sky-50 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-sky-600"
                            >
                              <BookmarkPlus className="h-3.5 w-3.5" />
                              <span>메모화</span>
                            </button>
                          );
                        })()}

                        <button
                          type="button"
                          onClick={() => handleCopyAnswer(msg.id, msg.text)}
                          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-600"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              <span className="text-emerald-700">복사됨</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              <span>답변 복사</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {msg.error ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <div className="leading-relaxed">{msg.error}</div>
                    </div>
                  ) : msg.text ? (
                    <MarkdownRenderer content={msg.text} />
                  ) : (
                    <div className="space-y-2 py-1 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
                        <span className="font-medium text-slate-800">{stageLabel}...</span>
                        <span className="font-mono text-xs text-slate-500 tabular-nums">
                          {formatSeconds(elapsedMs)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {msg.stage === "sending"
                          ? "이미지 및 질문 내용을 서버로 전달하고 있습니다."
                          : "모델이 이미지 속 텍스트와 문맥을 읽고 답변을 준비하고 있습니다."}
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 bg-white px-4 py-3.5 sm:px-8">
        <form onSubmit={handleSubmit} className="mx-auto w-full max-w-[780px]">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-1.5">
              {isSharing ? (
                <>
                  <Camera className="h-3.5 w-3.5 text-sky-600" />
                  <span className="text-slate-700">
                    전송 시 현재 공유 화면을 JPEG로 자동 캡처해 함께 보냅니다
                  </span>
                </>
              ) : (
                <>
                  <Monitor className="h-3.5 w-3.5 text-slate-400" />
                  <span>화면 공유 꺼짐 · 이미지 첨부(Ctrl+V) 및 텍스트 전송 가능</span>
                </>
              )}
              {!isSharing && (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={onStartShare}
                    className="font-medium text-sky-700 hover:text-sky-800 hover:underline focus-visible:outline-2 focus-visible:outline-sky-600"
                  >
                    화면 공유 켜기
                  </button>
                </>
              )}
            </div>

            <div
              role="group"
              aria-label="답변 속도 모드"
              className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5"
            >
              <button
                type="button"
                onClick={() => onChangeResponseMode("fast")}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
                  responseMode === "fast"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                빠른 답변
              </button>
              <button
                type="button"
                onClick={() => onChangeResponseMode("deep")}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
                  responseMode === "deep"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                정밀 분석
              </button>
            </div>
          </div>

          {attachmentError && (
            <div
              role="alert"
              className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
            >
              <span>{attachmentError}</span>
              <button
                type="button"
                onClick={() => setAttachmentError(null)}
                aria-label="경고 닫기"
                className="rounded p-0.5 text-amber-700 hover:bg-amber-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 transition-colors focus-within:border-sky-600 focus-within:bg-white">
            {/* Attached Images Preview Strip */}
            {(attachedImages.length > 0 || isProcessingImages) && (
              <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-slate-200/80 px-1 pb-2">
                {attachedImages.map((img) => (
                  <div
                    key={img.id}
                    className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => setLightboxImage(img.dataUrl)}
                      className="h-full w-full focus-visible:outline-2 focus-visible:outline-sky-600"
                      title={`${img.name || "첨부 이미지"} 크게 보기`}
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.name || "첨부된 이미지 미리보기"}
                        className="h-full w-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(img.id)}
                      aria-label="첨부 이미지 삭제"
                      title="이미지 삭제"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/75 text-white transition-colors hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}

                {isProcessingImages && (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
                  </div>
                )}
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileInputChange}
                className="hidden"
                aria-hidden="true"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming || attachedImages.length >= MAX_ATTACHED_IMAGES}
                title="사진 첨부 (파일 선택 또는 Ctrl+V 붙여넣기)"
                aria-label="사진 첨부"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sky-600"
              >
                <ImagePlus className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMemoMode((prev) => !prev);
                  textareaRef.current?.focus();
                }}
                disabled={isStreaming}
                aria-pressed={isMemoMode}
                title="메모·암기 노트 생성 모드 (켜면 복사용 메모와 암기 카드로 정리됩니다)"
                className={`inline-flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
                  isMemoMode
                    ? "border-sky-300 bg-sky-50 text-sky-800"
                    : "border-transparent text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
                }`}
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">메모화</span>
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handleTextareaPaste}
                rows={1}
                placeholder={
                  isMemoMode
                    ? "메모화할 책의 부분이나 암기할 내용을 지시하세요 (Ctrl+Enter 전송)"
                    : "질문을 입력하세요 (Ctrl+Enter 전송 · Enter 줄바꿈 · Ctrl+V 이미지 붙여넣기)"
                }
                className="max-h-44 min-h-[40px] flex-1 resize-none bg-transparent px-1.5 py-2 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />

              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStopStreaming}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-600"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  <span>중지</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  title="전송 (Ctrl+Enter)"
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-600 px-4 text-xs font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 focus-visible:outline-2 focus-visible:outline-sky-600"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>전송</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Screenshot / Attached Image Lightbox */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="이미지 크게 보기"
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-full max-w-5xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 text-xs text-slate-300">
              <span>이미지 크게 보기</span>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                aria-label="닫기"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={lightboxImage}
              alt="확대된 이미지"
              className="max-h-[82vh] w-auto object-contain"
            />
          </div>
        </div>
      )}
    </section>
  );
};
