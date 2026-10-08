// Decimal input must resolve to whole persisted units without binary float rounding.
export function scaleWholeNumber(value: string | number, scale: number): number {
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(String(value).trim());
  if (!match || !Number.isSafeInteger(scale) || scale <= 0) return Number.NaN;
  const fraction = match[3] ?? "";
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${match[1]}${match[2]}${fraction}`) * BigInt(scale);
  if (numerator % denominator !== 0n) return Number.NaN;
  const result = Number(numerator / denominator);
  return Number.isSafeInteger(result) ? result : Number.NaN;
}
