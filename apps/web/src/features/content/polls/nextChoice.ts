/** The next list of chosen options after the user taps `index`. */
export const nextChoice = (current: number[], index: number, allowMultiple: boolean): number[] => {
  if (current.includes(index)) return current.filter((i) => i !== index);
  return allowMultiple ? [...current, index].sort((a, b) => a - b) : [index];
};
