export type PreviewSize = "compact" | "standard" | "large";
export type ResponseMode = "fast" | "deep";
export type ResponseStage = "sending" | "thinking" | "streaming" | "done" | "stopped" | "error";

export interface ChatImageAttachment {
  id: string;
  dataUrl: string;
  source: "screen" | "attachment";
  name?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  imageDataUrl?: string;
  attachments?: ChatImageAttachment[];
  createdAt: number;
  startedAt?: number;
  firstTokenAt?: number;
  completedAt?: number;
  stage?: ResponseStage;
  error?: string;
}

export interface MemoFlashcard {
  id: string;
  front: string;
  back: string;
}

export type StudyFlowKind = "qa" | "memo";

export interface StudyMemoData {
  memoText: string;
  flashcards: MemoFlashcard[];
  memorized?: boolean;
}

export interface StudyFlowStep {
  id: string;
  messageId: string;
  kind?: StudyFlowKind;
  title: string;
  note: string;
  createdAt: number;
  hadImage: boolean;
  status: "pending" | "ready";
  memoData?: StudyMemoData;
}

export interface StudyPreset {
  id: string;
  label: string;
  prompt: string;
}

export const DEFAULT_SYSTEM_PROMPT =
  "한국어로 친절한 과외 선생님처럼 단계별로 설명해줘. 핵심 개념을 먼저 짚고, 풀이 과정이나 코드 동작 원리를 차근차근 알려줘.";

export const STUDY_PRESETS: StudyPreset[] = [
  {
    id: "tutor",
    label: "친절한 과외 선생님",
    prompt: DEFAULT_SYSTEM_PROMPT,
  },
  {
    id: "summary",
    label: "핵심 요약",
    prompt:
      "한국어로 핵심 개념과 결론부터 간결하게 정리해줘. 불필요한 서론 없이 글머리 기호와 표를 활용해 한눈에 들어오게 설명해줘.",
  },
  {
    id: "code",
    label: "코드·디버깅 멘토",
    prompt:
      "한국어로 시니어 개발자 멘토처럼 화면의 코드를 분석해줘. 버그 원인, 시간/공간 복잡도, 더 나은 리팩토링 예시를 코드 블록으로 정확히 설명해줘.",
  },
  {
    id: "socratic",
    label: "힌트 중심 (소크라테스식)",
    prompt:
      "한국어로 정답을 바로 알려주지 말고, 내가 스스로 답을 찾을 수 있도록 1~2단계 힌트와 생각할 질문을 던져줘. 내가 답을 말하면 다음 단계로 넘어가줘.",
  },
];
