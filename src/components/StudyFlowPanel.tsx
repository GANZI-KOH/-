import React, { useMemo, useState } from "react";
import {
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  ListOrdered,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
} from "lucide-react";
import type { StudyFlowStep } from "../types/tutor";

interface StudyFlowPanelProps {
  steps: StudyFlowStep[];
  activeMessageIds: Set<string>;
  isCollapsed: boolean;
  expandedMemoId: string | null;
  onToggleExpandMemo: (stepId: string) => void;
  onToggleMemorized: (stepId: string) => void;
  onToggleCollapse: () => void;
  onSelectStep: (messageId: string) => void;
  onClearFlow: () => void;
}

type FlowFilter = "all" | "memo";

function formatStepTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatStepNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function buildCopyableMemoText(step: StudyFlowStep, includeFlashcards = true): string {
  const lines: string[] = [`# ${step.title}`];
  if (step.memoData?.memoText) {
    lines.push("", step.memoData.memoText.trim());
  } else if (step.note) {
    lines.push("", step.note);
  }
  if (includeFlashcards && step.memoData?.flashcards && step.memoData.flashcards.length > 0) {
    lines.push("", "[암기 체크 Q&A]");
    for (const card of step.memoData.flashcards) {
      lines.push(`- Q: ${card.front}`);
      lines.push(`  A: ${card.back}`);
    }
  }
  return lines.join("\n");
}

export const StudyFlowPanel: React.FC<StudyFlowPanelProps> = ({
  steps,
  activeMessageIds,
  isCollapsed,
  expandedMemoId,
  onToggleExpandMemo,
  onToggleMemorized,
  onToggleCollapse,
  onSelectStep,
  onClearFlow,
}) => {
  const [filter, setFilter] = useState<FlowFilter>("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [revealedCardIds, setRevealedCardIds] = useState<Set<string>>(() => new Set());

  const memoSteps = useMemo(
    () => steps.filter((step) => step.kind === "memo"),
    [steps]
  );

  const visibleSteps = filter === "memo" ? memoSteps : steps;

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleCopyAll = () => {
    if (visibleSteps.length === 0) return;
    const todayLabel = new Date().toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    if (filter === "memo") {
      const text = [
        `오늘 암기·메모 정리 (${todayLabel})`,
        "",
        ...memoSteps.map((step) => buildCopyableMemoText(step, true)),
      ].join("\n\n---\n\n");
      void copyText("header-all", text);
      return;
    }

    const lines = steps.map((step, index) => {
      const time = formatStepTime(step.createdAt);
      const tag = step.kind === "memo" ? "[메모·암기] " : "";
      const notePart = step.note ? ` — ${step.note}` : "";
      return `${index + 1}. [${time}] ${tag}${step.title}${notePart}`;
    });
    const text = `오늘 공부한 흐름 (${todayLabel})\n${lines.join("\n")}`;
    void copyText("header-all", text);
  };

  const toggleRevealCard = (cardId: string) => {
    setRevealedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  if (isCollapsed) {
    const latestStep = steps[steps.length - 1];
    return (
      <aside
        aria-label="오늘 공부한 흐름 (접힘)"
        className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2 lg:w-12 lg:flex-col lg:justify-start lg:gap-3 lg:border-r lg:border-b-0 lg:px-1.5 lg:py-3"
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          title="오늘 공부한 흐름 펼치기"
          aria-label="오늘 공부한 흐름 펼치기"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-600 lg:w-9 lg:justify-center lg:px-0"
        >
          <PanelLeftOpen className="hidden h-4 w-4 shrink-0 lg:block" />
          <ChevronDown className="h-4 w-4 shrink-0 lg:hidden" />
          <span className="whitespace-nowrap lg:hidden">오늘 공부한 흐름</span>
        </button>

        <div className="flex min-w-0 items-center gap-2 lg:flex-col">
          {latestStep && (
            <span className="truncate text-xs text-slate-500 lg:hidden">
              {latestStep.title}
            </span>
          )}
          <span
            title={`오늘 흐름 ${steps.length}개 · 메모 ${memoSteps.length}개`}
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-slate-100 px-1.5 font-mono text-[11px] font-semibold text-slate-700 tabular-nums"
          >
            {steps.length}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="오늘 공부한 흐름"
      className="flex max-h-[280px] shrink-0 flex-col border-b border-slate-200 bg-white lg:max-h-none lg:w-[296px] lg:border-r lg:border-b-0 xl:w-[320px]"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ListOrdered className="h-4 w-4 shrink-0 text-sky-600" />
          <h2 className="truncate text-xs font-semibold text-slate-900">오늘 공부한 흐름</h2>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600 tabular-nums">
            {steps.length}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {visibleSteps.length > 0 && (
            <button
              type="button"
              onClick={handleCopyAll}
              title={filter === "memo" ? "메모 전체 복사" : "공부 흐름 복사"}
              aria-label={filter === "memo" ? "메모 전체 복사" : "공부 흐름 복사"}
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-600"
            >
              {copiedKey === "header-all" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-emerald-700">복사됨</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">
                    {filter === "memo" ? "전체 복사" : "복사"}
                  </span>
                </>
              )}
            </button>
          )}

          {steps.length > 0 && (
            <button
              type="button"
              onClick={onClearFlow}
              title="오늘 흐름 비우기"
              aria-label="오늘 흐름 비우기"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-sky-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={onToggleCollapse}
            title="오늘 공부한 흐름 접기"
            aria-label="오늘 공부한 흐름 접기"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600"
          >
            <PanelLeftClose className="hidden h-3.5 w-3.5 lg:block" />
            <ChevronUp className="h-3.5 w-3.5 lg:hidden" />
            <span>접기</span>
          </button>
        </div>
      </div>

      {/* Filter Bar (All vs Memo/Memorize) */}
      {steps.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 bg-slate-50/70 px-3 py-1.5">
          <div
            role="tablist"
            aria-label="공부 흐름 보기 필터"
            className="grid w-full grid-cols-2 gap-1 rounded-lg bg-slate-100 p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              onClick={() => setFilter("all")}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
                filter === "all"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              전체 흐름 ({steps.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "memo"}
              onClick={() => setFilter("memo")}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
                filter === "memo"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              메모·암기 ({memoSteps.length})
            </button>
          </div>
        </div>
      )}

      {/* Concise Vertical Flow List */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {visibleSteps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-3 py-4 text-center">
            <p className="text-xs leading-relaxed text-slate-500">
              {filter === "memo"
                ? '채팅에서 "이 부분 메모화 해줘"라고 입력하거나 답변의 메모화 버튼을 누르면 복사하기 좋은 암기 노트가 여기에 정리됩니다.'
                : '질문을 주고받거나 "메모화 해줘"라고 요청하면 오늘 공부한 흐름과 암기 노트가 간략히 정리됩니다.'}
            </p>
          </div>
        ) : (
          <ol className="relative space-y-2 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-slate-200">
            {visibleSteps.map((step, index) => {
              const isJumpable = activeMessageIds.has(step.messageId);
              const isPending = step.status === "pending";
              const isMemo = step.kind === "memo";
              const isExpanded = isMemo && expandedMemoId === step.id;
              const isMemorized = Boolean(step.memoData?.memorized);
              const stepNumber =
                filter === "all"
                  ? formatStepNumber(index)
                  : formatStepNumber(steps.findIndex((s) => s.id === step.id));

              return (
                <li key={step.id} className="relative">
                  <div
                    className={`rounded-lg transition-colors ${
                      isExpanded
                        ? "border border-sky-200 bg-sky-50/35 p-2"
                        : "px-1.5 py-1 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold tabular-nums ${
                          isPending
                            ? "border-sky-300 bg-sky-50 text-sky-700"
                            : isMemo
                              ? isMemorized
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                : "border-sky-300 bg-sky-50 text-sky-700"
                              : isJumpable
                                ? "border-slate-300 bg-white text-slate-700"
                                : "border-slate-200 bg-slate-50 text-slate-400"
                        }`}
                      >
                        {isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin text-sky-600" />
                        ) : isMemo ? (
                          <BookmarkCheck className="h-3 w-3" />
                        ) : (
                          stepNumber
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (isMemo) {
                                onToggleExpandMemo(step.id);
                              } else if (isJumpable) {
                                onSelectStep(step.messageId);
                              }
                            }}
                            disabled={!isMemo && !isJumpable}
                            className={`min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-sky-600 ${
                              isMemo || isJumpable ? "cursor-pointer" : "cursor-default"
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              {isMemo && (
                                <span
                                  className={`shrink-0 rounded px-1 py-0.2 text-[10px] font-semibold ${
                                    isMemorized
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-sky-100 text-sky-700"
                                  }`}
                                >
                                  {isMemorized ? "암기완료" : "메모"}
                                </span>
                              )}
                              <span
                                className={`truncate text-xs font-semibold ${
                                  isJumpable || isMemo ? "text-slate-900" : "text-slate-600"
                                }`}
                              >
                                {step.title}
                              </span>
                            </div>

                            {step.note && (
                              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">
                                {step.note}
                              </p>
                            )}
                          </button>

                          <div className="flex shrink-0 items-center gap-1 pt-0.5">
                            <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                              {formatStepTime(step.createdAt)}
                            </span>

                            {isMemo && !isPending && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void copyText(
                                      `copy-${step.id}`,
                                      buildCopyableMemoText(step, true)
                                    )
                                  }
                                  title="메모 복사하기"
                                  aria-label="메모 복사하기"
                                  className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-600"
                                >
                                  {copiedKey === `copy-${step.id}` ? (
                                    <Check className="h-3 w-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onToggleExpandMemo(step.id)}
                                  title={isExpanded ? "메모 접기" : "메모 및 암기 카드 열기"}
                                  aria-label={isExpanded ? "메모 접기" : "메모 및 암기 카드 열기"}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-600"
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {step.hadImage && !isJumpable && !isMemo && (
                          <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-400">
                            <ImageIcon className="h-2.5 w-2.5" />
                            <span>이전 대화</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Expanded Inline Memo & Memorization Cards */}
                    {isExpanded && step.memoData && (
                      <div className="mt-2.5 space-y-2.5 border-t border-sky-200/80 pt-2.5 pl-1">
                        {/* Copy-Paste Memo Body */}
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-slate-700">
                              복사용 정리 메모
                            </span>
                            <div className="flex items-center gap-1.5">
                              {isJumpable && (
                                <button
                                  type="button"
                                  onClick={() => onSelectStep(step.messageId)}
                                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
                                >
                                  <MessageSquare className="h-2.5 w-2.5" />
                                  <span>대화 위치</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  void copyText(
                                    `memo-only-${step.id}`,
                                    step.memoData?.memoText || buildCopyableMemoText(step, false)
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
                              >
                                {copiedKey === `memo-only-${step.id}` ? (
                                  <>
                                    <Check className="h-2.5 w-2.5 text-emerald-600" />
                                    <span className="text-emerald-700">복사됨</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-2.5 w-2.5" />
                                    <span>메모 복사</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2.5 text-xs leading-relaxed text-slate-800 whitespace-pre-wrap select-all">
                            {step.memoData.memoText}
                          </div>
                        </div>

                        {/* Interactive Memorization Q&A Cards */}
                        {step.memoData.flashcards.length > 0 && (
                          <div>
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-slate-700">
                                암기 체크 ({step.memoData.flashcards.length})
                              </span>
                              <button
                                type="button"
                                onClick={() => onToggleMemorized(step.id)}
                                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                  isMemorized
                                    ? "bg-emerald-600 text-white"
                                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                                }`}
                              >
                                <Check className="h-2.5 w-2.5" />
                                <span>{isMemorized ? "암기 완료됨" : "암기 완료 표시"}</span>
                              </button>
                            </div>

                            <div className="space-y-1.5">
                              {step.memoData.flashcards.map((card) => {
                                const isRevealed = revealedCardIds.has(card.id);
                                return (
                                  <button
                                    key={card.id}
                                    type="button"
                                    onClick={() => toggleRevealCard(card.id)}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left transition-colors hover:border-sky-300 focus-visible:outline-2 focus-visible:outline-sky-600"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="text-[11px] font-medium leading-snug text-slate-900">
                                        {card.front}
                                      </span>
                                      <span className="mt-0.5 shrink-0 text-slate-400">
                                        {isRevealed ? (
                                          <EyeOff className="h-3 w-3" />
                                        ) : (
                                          <Eye className="h-3 w-3" />
                                        )}
                                      </span>
                                    </div>
                                    {isRevealed ? (
                                      <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-[11px] leading-snug text-sky-800">
                                        {card.back}
                                      </div>
                                    ) : (
                                      <div className="mt-1 text-[10px] text-slate-400">
                                        클릭해서 정답 확인
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </aside>
  );
};
