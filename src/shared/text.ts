// "1st", "2nd", "3rd", "4th"... including the teens, which break the pattern.
// Shared because both sides count things: the main process labels milestones,
// the recap page labels placements. The number itself is grouped the way
// `locale` writes it: "1,000th", or "1.000th" in pt-BR.
export function ordinal(n: number, locale: string | undefined): string {
  const digits = n.toLocaleString(locale);
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${digits}th`;
  switch (n % 10) {
    case 1:
      return `${digits}st`;
    case 2:
      return `${digits}nd`;
    case 3:
      return `${digits}rd`;
    default:
      return `${digits}th`;
  }
}
