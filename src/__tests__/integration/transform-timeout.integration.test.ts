import { Flow } from '../../types';
import { FlowExecutor } from '../../flow-executor';
import { TestLogger } from '../../util/logger';
import { TimeoutError } from '../../errors/timeout-error';

describe('Integration: Transform Step Timeout (real timers)', () => {
  it('should abort a slow transform step if timeout is hit', async () => {
    // Use a large array and a computationally expensive expression to simulate slowness
    const itemCount = 500_000;
    const items = Array.from({ length: itemCount }, (_, i) => i + 1);

    const flow: Flow = {
      name: 'transform-timeout-test',
      description: 'Test that a slow transform step is aborted by timeout',
      steps: [
        {
          name: 'slowTransform',
          policies: { timeout: { timeout: 1 } }, // 2ms timeout
          transform: {
            input: items, // array literal
            operations: [
              {
                type: 'map',
                // A simple expression, but repeated over a huge array
                using: '${item} * 32',
              },
            ],
          },
        },
      ],
    };

    const logger = new TestLogger('TransformTimeoutIntegration');
    // Provide a dummy handler (not used for transform steps)
    const dummyHandler = async () => ({ result: null });
    const executor = new FlowExecutor(flow, dummyHandler, logger);

    const start = Date.now();
    const promise = executor.execute();
    let errorCaught = false;
    let error: any = null;
    try {
      await promise;
    } catch (err) {
      errorCaught = true;
      error = err;
      // eslint-disable-next-line no-console
      console.log('Error:', err);
    }
    const elapsed = Date.now() - start;
    // Log the elapsed time for manual inspection
    // eslint-disable-next-line no-console
    console.log('Elapsed time (ms):', elapsed);
    expect(elapsed).toBeLessThan(500);
    // The operation SHOULD throw a TimeoutError
    expect(errorCaught).toBe(true);
    expect(error).toBeInstanceOf(TimeoutError);
  });
}); 