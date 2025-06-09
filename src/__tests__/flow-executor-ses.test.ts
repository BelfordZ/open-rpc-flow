import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { TestLogger } from '../util/logger';

describe('FlowExecutor with SesExpressionEvaluator', () => {
  it('executes a transform step using the SES evaluator', async () => {
    const flow: Flow = {
      name: 'Ses Flow',
      description: '',
      steps: [
        {
          name: 'double',
          transform: {
            input: '[1, 2, 3]',
            operations: [{ type: 'map', using: 'item * 2' }],
          },
        },
      ],
    };
    const executor = new FlowExecutor(flow, jest.fn(), {
      logger: new TestLogger('ses'),
      evaluatorType: 'ses',
    });
    const results = await executor.execute();
    expect(results.get('double').result).toEqual([2, 4, 6]);
  });
});
