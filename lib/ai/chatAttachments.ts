export const MAX_CHAT_IMAGES = 5;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_CHAT_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;

const SUPPORTED_CHAT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

interface ChatImageFile {
  name: string;
  type: string;
  size: number;
}

export function validateChatImageSelection(existing: ReadonlyArray<Pick<ChatImageFile, 'size'>>, files: ReadonlyArray<ChatImageFile>): string | null {
  if (existing.length + files.length > MAX_CHAT_IMAGES) return `Attach up to ${MAX_CHAT_IMAGES} images to one question.`;
  const unsupported = files.find(file => !SUPPORTED_CHAT_IMAGE_TYPES.has(file.type));
  if (unsupported) return `${unsupported.name} is not a supported image. Use JPEG, PNG, WebP, or GIF.`;
  const oversized = files.find(file => file.size > MAX_CHAT_IMAGE_BYTES);
  if (oversized) return `${oversized.name} exceeds the 5 MB image limit.`;
  const totalBytes = [...existing, ...files].reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_CHAT_IMAGE_TOTAL_BYTES) return 'Attachments exceed the 20 MB total limit.';
  return null;
}
