export function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

