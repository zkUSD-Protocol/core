import { Provable } from 'o1js';

export async function measurePerformance<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  // Log the label in-circuit (Provable.log)
  Provable.log(label);

  // Measure wall-clock time
  const start = performance.now();
  const result = await fn();
  const end = performance.now();

  // Log it out of circuit (console)
  console.log(`${label} took ${(end - start).toFixed(2)}ms`);

  return result;
}
