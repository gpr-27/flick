/** "99+" style cap for unread counters. */
export const formatCount = (n: number): string => (n > 99 ? '99+' : String(n));
