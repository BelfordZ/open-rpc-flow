import { getDataType } from '../type-utils';

describe('getDataType', () => {
  it('returns array for arrays', () => {
    expect(getDataType([1, 2])).toBe('array');
  });

  it('returns null for null values', () => {
    expect(getDataType(null)).toBe('null');
  });

  it('returns typeof value for others', () => {
    expect(getDataType('foo')).toBe('string');
    expect(getDataType(123)).toBe('number');
    expect(getDataType({})).toBe('object');
  });
});
