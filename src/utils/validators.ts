// Note: zod is not currently installed in this project.
// Keeping this file to match the target architecture; once zod is added we can
// replace these lightweight validators with real Zod schemas.

export function validateString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}


