export function ensureMinArrayLength<T>(
  arr: T[],
  minLength: number,
  defaultValue: T
): T[] {
  if (arr.length >= minLength) {
    return arr;
  }
  const additionalElements = Array.from(
    { length: minLength - arr.length },
    () => defaultValue
  );
  return [...arr, ...additionalElements];
}
