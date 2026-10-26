/** Circular upload progress, 0 to 1. */
export const ringOffset = (fraction: number, circumference: number): number =>
  circumference * (1 - Math.min(1, Math.max(0, fraction)));
