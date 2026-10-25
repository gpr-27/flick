/**
 * A colour for a group member's name: the same person always gets the same one. It is mixed with
 * the text colour so it stays readable on light and dark themes.
 */
export const senderColor = (userId: string): string => {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `color-mix(in srgb, hsl(${hue} 70% 45%) 65%, currentColor)`;
};
