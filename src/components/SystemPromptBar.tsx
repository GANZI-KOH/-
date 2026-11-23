import React from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { DEFAULT_SYSTEM_PROMPT, STUDY_PRESETS } from "../types/tutor";

interface SystemPromptBarProps {
  isOpen: boolean;
  systemPrompt: string;
  onChangePrompt: (nextPrompt: string) => void;
  onClose: () => void;
}

export const SystemPromptBar: React.FC<SystemPromptBarProps> = ({
  isOpen,
  systemPrompt,
  onChangePrompt,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <section
      aria-label="학습 스타일 시스템 프롬프트 설정"
      className="border-b border-slate-200 bg-white px-4 py-3.5 sm:px-6"
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <SlidersHorizontal className="h-4 w-4 text-sky-600" />
            <span>AI 튜터 학습 스타일 (시스템 프롬프트)</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {STUDY_PRESETS.map((preset) => {
              const isSelected = systemPrompt.trim() === preset.prompt.trim();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onChangePrompt(preset.prompt)}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
                    isSelected
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onChangePrompt(DEFAULT_SYSTEM_PROMPT)}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-600"
              title="기본 프롬프트로 되돌리기"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>기본값</span>
            </button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-end">
          <textarea
            value={systemPrompt}
            onChange={(e) => onChangePrompt(e.target.value)}
            rows={2}
            placeholder="예: 한국어로 친절한 과외 선생님처럼 단계별로 설명해줘"
            className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:bg-white focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-600"
          >
            접기
          </button>
        </div>
      </div>
    </section>
  );
};
