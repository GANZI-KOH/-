import React from "react";
import {
  AlertCircle,
  Camera,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Monitor,
  MonitorOff,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import type { PreviewSize } from "../types/tutor";

interface ScreenSharePanelProps {
  isSharing: boolean;
  isCollapsed: boolean;
  isHidden: boolean;
  previewSize: PreviewSize;
  videoResolution: { width: number; height: number } | null;
  shareError: string | null;
  lastCaptureAt: number | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onStartShare: () => void;
  onStopShare: () => void;
  onToggleCollapse: () => void;
  onHidePanel: () => void;
  onChangeSize: (size: PreviewSize) => void;
  onDismissError: () => void;
}

const SIZE_OPTIONS: { value: PreviewSize; label: string }[] = [
  { value: "compact", label: "작게" },
  { value: "standard", label: "기본" },
  { value: "large", label: "크게" },
];

const WIDTH_CLASS_MAP: Record<PreviewSize, string> = {
  compact: "lg:w-[340px] xl:w-[380px]",
  standard: "lg:w-[460px] xl:w-[520px]",
  large: "lg:w-[600px] xl:w-[680px]",
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export const ScreenSharePanel: React.FC<ScreenSharePanelProps> = ({
  isSharing,
  isCollapsed,
  isHidden,
  previewSize,
  videoResolution,
  shareError,
  lastCaptureAt,
  videoRef,
  onStartShare,
  onStopShare,
  onToggleCollapse,
  onHidePanel,
  onChangeSize,
  onDismissError,
}) => {
  // When completely omitted, keep offscreen video mounted so active sharing keeps working quietly
  if (isHidden) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -left-[9999px] top-0 h-48 w-80 opacity-0"
      >
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full" />
      </div>
    );
  }

  // Keep video element mounted offscreen when collapsed so canvas capture never stops decoding
  if (isCollapsed) {
    return (
      <aside
        aria-label="화면 공유 컨트롤 (접힘)"
        className="relative flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 lg:w-14 lg:flex-col lg:justify-start lg:gap-4 lg:border-r lg:border-b-0 lg:px-2 lg:py-4"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none fixed -left-[9999px] top-0 h-48 w-80 opacity-0"
        >
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full" />
        </div>

        <button
          type="button"
          onClick={onToggleCollapse}
          title="공유 화면 펼치기"
          aria-label="공유 화면 펼치기"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-600 lg:w-10 lg:justify-center lg:px-0"
        >
          <PanelLeftOpen className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap lg:hidden">공유 화면 펼치기</span>
        </button>

        <div className="flex items-center gap-3 lg:flex-col">
          <div className="flex items-center gap-2 text-xs text-slate-600 lg:hidden">
            {isSharing ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" />
                <span className="font-medium text-slate-900">화면 공유 중</span>
              </>
            ) : (
              <span>공유 꺼짐</span>
            )}
          </div>

          <button
            type="button"
            onClick={isSharing ? onStopShare : onStartShare}
            title={isSharing ? "화면 공유 중지" : "화면 공유 시작"}
            aria-label={isSharing ? "화면 공유 중지" : "화면 공유 시작"}
            className={`inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 lg:w-10 lg:px-0 ${
              isSharing
                ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                : "bg-sky-600 text-white hover:bg-sky-700"
            }`}
          >
            {isSharing ? (
              <>
                <MonitorOff className="h-4 w-4 shrink-0" />
                <span className="lg:hidden">공유 중지</span>
              </>
            ) : (
              <>
                <Monitor className="h-4 w-4 shrink-0" />
                <span className="lg:hidden">공유 시작</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onHidePanel}
            title="공유 화면 패널 생략하기"
            aria-label="공유 화면 패널 생략하기"
            className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600 lg:w-10 lg:px-0"
          >
            <EyeOff className="h-4 w-4 shrink-0" />
            <span className="lg:hidden">생략</span>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="실시간 화면 공유 미리보기"
      className={`flex shrink-0 flex-col border-b border-slate-200 bg-white lg:border-r lg:border-b-0 ${WIDTH_CLASS_MAP[previewSize]}`}
    >
      {/* Panel Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={isSharing ? onStopShare : onStartShare}
            className={`inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
              isSharing
                ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                : "bg-sky-600 text-white hover:bg-sky-700"
            }`}
          >
            {isSharing ? (
              <>
                <MonitorOff className="h-4 w-4 shrink-0" />
                <span>화면 공유 중지</span>
              </>
            ) : (
              <>
                <Monitor className="h-4 w-4 shrink-0" />
                <span>화면 공유 시작</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Size Segmented Toggle (Desktop) */}
          <div
            role="group"
            aria-label="공유 화면 크기 조절"
            className="hidden items-center gap-0.5 rounded-lg bg-slate-100 p-1 lg:flex"
          >
            {SIZE_OPTIONS.map((opt) => {
              const active = previewSize === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeSize(opt.value)}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 ${
                    active
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onToggleCollapse}
            title="공유 화면 접기"
            aria-label="공유 화면 접기"
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600"
          >
            <PanelLeftClose className="hidden h-4 w-4 lg:block" />
            <ChevronLeft className="h-4 w-4 lg:hidden" />
            <span>접기</span>
          </button>

          <button
            type="button"
            onClick={onHidePanel}
            title="공유 화면 패널 생략하기 (공유 중이면 백그라운드 유지)"
            aria-label="공유 화면 패널 생략하기"
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600"
          >
            <EyeOff className="h-3.5 w-3.5" />
            <span>생략</span>
          </button>
        </div>
      </div>

      {/* Share Error Banner */}
      {shareError && (
        <div
          role="alert"
          className="mx-4 mt-3 flex items-start justify-between gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs leading-relaxed text-red-800"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{shareError}</span>
          </div>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="오류 닫기"
            className="rounded p-0.5 text-red-600 hover:bg-red-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Video Preview Viewport */}
      <div className="flex flex-1 flex-col justify-between p-4">
        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-950 lg:aspect-auto lg:min-h-[260px] lg:flex-1">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-contain ${isSharing ? "block" : "hidden"}`}
          />

          {!isSharing && (
            <div className="flex max-w-xs flex-col items-center px-5 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-300">
                <Monitor className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-sm font-semibold text-slate-100">
                공유 중인 화면이 없습니다
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                공부 중인 강의, PDF, 코드 에디터 또는 문제 창을 공유하면 질문할 때마다 현재 화면을
                자동으로 캡처해 함께 분석합니다.
              </p>
              <button
                type="button"
                onClick={onStartShare}
                className="mt-5 inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-sky-600 px-4 text-xs font-medium text-white transition-colors hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                <span>공유할 화면 선택하기</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Clean Unboxed Stream Metadata */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
          <div className="flex items-center gap-2">
            {isSharing ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" />
                <span className="font-medium text-slate-800">실시간 공유 중</span>
                {videoResolution && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">
                      {videoResolution.width}×{videoResolution.height}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span>대기 중 · 텍스트 단독 질문도 가능</span>
            )}
          </div>

          {lastCaptureAt && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <Camera className="h-3.5 w-3.5 text-slate-400" />
              <span>최근 캡처 {formatTime(lastCaptureAt)}</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
