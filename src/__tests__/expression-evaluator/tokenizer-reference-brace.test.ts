import { tokenize } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Reference Nested Braces', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  // This test targets lines 220-224 in tokenizer.ts which handle nested curly braces
  it('handles nested curly braces in references', () => {
    // The expression contains a nested curly brace that should increment the bracketCount
    const expression = '${foo{bar}}';
    
    const result = tokenize(expression, logger);
    
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('reference');
    
    // The reference should contain both 'foo' and 'bar' as parts of its tokens
    const referenceValue = (result[0] as any).value;
    expect(referenceValue.length).toBeGreaterThan(1);
    
    // Check that at least one token contains 'foo' and one contains 'bar'
    const tokens = referenceValue.map((t: any) => t.value);
    const joinedTokens = tokens.join('');
    expect(joinedTokens).toContain('foo');
    expect(joinedTokens).toContain('bar');
  });

  it('handles multiple levels of nested braces in references', () => {
    // This should test the bracketCount increment multiple times
    const expression = '${foo{bar{baz}}}';
    
    const result = tokenize(expression, logger);
    
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('reference');
  });

  it('handles nested braces with identifiers and operators', () => {
    // Test with braces and various tokenizable elements
    const expression = '${obj{prop: value}}';
    
    const result = tokenize(expression, logger);
    
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('reference');
  });

  it('handles object literals with nested braces inside references', () => {
    // Test with object literal syntax inside a reference
    const expression = '${obj = { nested: { prop: value } }}';
    
    const result = tokenize(expression, logger);
    
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('reference');
  });
}); 