// Decoding Clarity values, without pulling stacks.js in.
//
// `app.ts` needs these while rendering, and rendering happens whether or not a
// deployment is configured -- so they live apart from `chain.ts`, which is
// loaded on demand.

/** Anything a Clarity read can decode to, once the wrappers are stripped. */
export type Plain =
  | string
  | number
  | boolean
  | null
  | Plain[]
  | { [key: string]: Plain };

/** `cvToValue` leaves `{type, value}` wrappers on nested fields. Strip them. */
export function plain(value: unknown): Plain {
  if (value === null || typeof value !== "object") return value as Plain;
  if (Array.isArray(value)) return value.map(plain);
  const record = value as Record<string, unknown>;
  if ("type" in record && "value" in record) return plain(record.value);
  return Object.fromEntries(
    Object.entries(record).map(([key, inner]) => [key, plain(inner)]),
  );
}

export const num = (value: unknown): number => Number(plain(value) ?? 0);
