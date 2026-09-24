import Ajv from 'ajv';
import metaSchema from '../../meta-schema.json';

const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(metaSchema);

const validRequestStep = (name: string) => ({
  name,
  request: { method: 'test.method', params: {} },
});

describe('meta-schema condition steps', () => {
  it('still accepts if/then/else', () => {
    const flow = {
      name: 'f',
      steps: [
        {
          name: 'check',
          condition: {
            if: '${a} === 1',
            then: validRequestStep('yes'),
            else: validRequestStep('no'),
          },
        },
      ],
    };
    expect(validate(flow)).toBe(true);
  });

  it('accepts a switch with cases and default', () => {
    const flow = {
      name: 'f',
      steps: [
        {
          name: 'route',
          condition: {
            switch: '${step1.status}',
            cases: {
              foo: validRequestStep('handleFoo'),
              bar: [validRequestStep('b1'), validRequestStep('b2')],
            },
            default: validRequestStep('handleDefault'),
          },
        },
      ],
    };
    expect(validate(flow)).toBe(true);
  });

  it('accepts a switch without default', () => {
    const flow = {
      name: 'f',
      steps: [
        {
          name: 'route',
          condition: {
            switch: '${step1.status}',
            cases: { foo: validRequestStep('handleFoo') },
          },
        },
      ],
    };
    expect(validate(flow)).toBe(true);
  });

  it('rejects a condition with both if and switch', () => {
    const flow = {
      name: 'f',
      steps: [
        {
          name: 'bad',
          condition: {
            if: 'true',
            then: validRequestStep('yes'),
            switch: '${x}',
            cases: { a: validRequestStep('a') },
          },
        },
      ],
    };
    expect(validate(flow)).toBe(false);
  });

  it('rejects a switch without cases', () => {
    const flow = {
      name: 'f',
      steps: [{ name: 'bad', condition: { switch: '${x}' } }],
    };
    expect(validate(flow)).toBe(false);
  });

  it('rejects a condition with neither if nor switch', () => {
    const flow = {
      name: 'f',
      steps: [{ name: 'bad', condition: {} }],
    };
    expect(validate(flow)).toBe(false);
  });
});
