import assert from 'assert';

// usage
// assertIsDefined(vaultStartingState,"vaultStartingState");

export function assertIsDefined<T>(
  value: T,
  valueName: string,
  message = ({ name }: { name: string }) => `${name} should not be undefined`
): asserts value is NonNullable<T> {
  assert.notStrictEqual(value, undefined, message({ name: valueName }));
}
