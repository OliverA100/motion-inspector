// One way to write a number as text, used by every export. The Elm port
// must produce the same text, so the rule is short and explicit:
// at most 6 decimals, no trailing zeros, never "-0".

export function formatNumber(value: number): string {
  // Too large to round by multiplying. These are whole numbers anyway.
  if (Math.abs(value) >= 1e15) return String(value);
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded + 0);
}

export function formatMs(value: number): string {
  return `${formatNumber(value)}ms`;
}
