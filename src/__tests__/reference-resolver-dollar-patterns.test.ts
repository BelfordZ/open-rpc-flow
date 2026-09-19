import { ReferenceResolver } from '../reference-resolver';
import { TestLogger } from '../util/logger';

describe('ReferenceResolver $-pattern interpolation (issue #146)', () => {
  let resolver: ReferenceResolver;
  let stepResults: Map<string, any>;
  let testLogger: TestLogger;

  beforeEach(() => {
    testLogger = new TestLogger('DollarPatternTest');
    stepResults = new Map();
    resolver = new ReferenceResolver(
      stepResults,
      {
        config: {
          enabled: true,
          threshold: 100,
        },
      },
      testLogger,
    );
  });

  afterEach(() => {
    testLogger.clear();
  });

  function setStepResult(name: string, value: any): void {
    stepResults.set(name, { result: value, type: 'request' });
  }

  it('interpolates a value containing $& literally', () => {
    setStepResult('step1', 'a$&b');
    expect(resolver.resolveReferences('x: ${step1.result}')).toBe('x: a$&b');
  });

  it("interpolates a value containing $' literally", () => {
    setStepResult('step1', "a$'b");
    expect(resolver.resolveReferences('x: ${step1.result} y')).toBe("x: a$'b y");
  });

  it('interpolates a value containing $` literally', () => {
    setStepResult('step1', 'a$`b');
    expect(resolver.resolveReferences('x: ${step1.result}')).toBe('x: a$`b');
  });

  it('interpolates a value containing $1 literally', () => {
    setStepResult('step1', 'a$1b');
    expect(resolver.resolveReferences('x: ${step1.result}')).toBe('x: a$1b');
  });

  it('interpolates a value containing $$ literally', () => {
    setStepResult('step1', 'a$$b');
    expect(resolver.resolveReferences('x: ${step1.result}')).toBe('x: a$$b');
  });

  it('interpolates multiple $-containing values in one template', () => {
    setStepResult('step1', 'price: $5');
    setStepResult('step2', "it's $'quoted'");
    expect(resolver.resolveReferences('${step1.result} and ${step2.result}')).toBe(
      "price: $5 and it's $'quoted'",
    );
  });

  it('leaves $-sequences in the template itself untouched', () => {
    setStepResult('step1', 'world');
    expect(resolver.resolveReferences('costs $5 and $& for ${step1.result}')).toBe(
      'costs $5 and $& for world',
    );
  });

  it('still interpolates non-string values correctly', () => {
    setStepResult('num', 42);
    setStepResult('flag', true);
    setStepResult('obj', { a: 1 });
    expect(resolver.resolveReferences('n=${num.result}')).toBe('n=42');
    expect(resolver.resolveReferences('f=${flag.result}')).toBe('f=true');
    expect(resolver.resolveReferences('o=${obj.result}')).toBe('o={"a":1}');
  });

  it('interpolates a value that is only a $-pattern', () => {
    setStepResult('step1', '$&');
    expect(resolver.resolveReferences('[${step1.result}]')).toBe('[$&]');
  });
});
