import { noLogger } from '../../util/logger';

describe('NoLogger', () => {
  test('exports a singleton NoLogger instance', () => {
    expect(noLogger).toBeDefined();
  });
});
