import type { ChatImageAttachment } from "../types/tutor";

function createAttachmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("이미지를 읽을 수 없습니다."));
      }
    };
    reader.onerror = () => reject(new Error("이미지 파일을 읽는 중 오류가 발생했습니다."));
    reader.readAsDataURL(file);
  });
}

function loadImageDimensions(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("지원하지 않는 이미지 형식이거나 손상된 이미지입니다."));
    img.src = url;
  });
}

const SUPPORTED_DIRECT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function processImageFile(
  file: File,
  maxDimension = 1600
): Promise<ChatImageAttachment> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageDimensions(objectUrl);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    const needsResize = width > maxDimension || height > maxDimension;
    const isDirectSupported = SUPPORTED_DIRECT_TYPES.has(file.type);
    const isSmallEnough = file.size <= 1.5 * 1024 * 1024;

    if (!needsResize && isDirectSupported && isSmallEnough) {
      const dataUrl = await readFileAsDataUrl(file);
      return {
        id: createAttachmentId(),
        dataUrl,
        source: "attachment",
        name: file.name || "붙여넣은 이미지",
      };
    }

    const scale = needsResize ? Math.min(maxDimension / width, maxDimension / height) : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("이미지를 변환하기 위한 캔버스 컨텍스트를 생성할 수 없습니다.");
    }

    // Fill white background before drawing so transparent PNGs convert cleanly to JPEG
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    return {
      id: createAttachmentId(),
      dataUrl,
      source: "attachment",
      name: file.name || "붙여넣은 이미지",
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
