// Russian plural agreement for counted nouns.
// plural(n, 'бревно', 'бревна', 'брёвен'): 1, 21, 101 -> one; 2-4, 22-24 -> few; 0, 5-20, 25-30 -> many.
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
