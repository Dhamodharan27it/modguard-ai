export function uniqPushFront<T>(arr: T[], item: T, maxLen: number): T[] {
  if (arr.includes(item)) return arr;
  const next = [item, ...arr];
  return next.slice(0, maxLen);
}

export function uniqRemove<T>(arr: T[], item: T): T[] {
  return arr.filter((x) => x !== item);
}

