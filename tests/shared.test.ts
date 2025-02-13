import { sharedFunction } from '../src/shared';

test('sharedFunction appends the message correctly', () => {
  const result = sharedFunction('Testing');
  expect(result).toBe('Shared says: Testing');
});
