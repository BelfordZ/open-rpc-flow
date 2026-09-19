import { FlowExecutor, Flow, JsonRpcRequest } from '../index';

type PersistedState = {
  context: Record<string, unknown>;
  stepResults: Record<string, unknown>;
};

/**
 * Demonstrates public pause/resume/retry APIs with seeded context and step results.
 */
const flow: Flow = {
  name: 'resume-retry-example',
  description: 'Demonstrates restoring context/results before resume and retry',
  steps: [
    {
      name: 'loadAccount',
      request: {
        method: 'account.get',
        params: {
          accountId: '${context.accountId}',
        },
      },
    },
    {
      name: 'calculateBalance',
      request: {
        method: 'account.calculateBalance',
        params: {
          accountId: '${loadAccount.result.id}',
        },
      },
    },
    {
      name: 'publishSummary',
      request: {
        method: 'notifications.publish',
        params: {
          accountId: '${loadAccount.result.id}',
          balance: '${calculateBalance.result.balance}',
        },
      },
    },
  ],
};

function createMockHandler() {
  let shouldFailCalculationOnce = true;

  return async (request: JsonRpcRequest) => {
    switch (request.method) {
      case 'account.get': {
        const params = request.params as Record<string, unknown> | undefined;
        return { id: params?.accountId, tier: 'gold' };
      }

      case 'account.calculateBalance':
        if (shouldFailCalculationOnce) {
          shouldFailCalculationOnce = false;
          throw new Error('Temporary upstream timeout');
        }
        return { balance: 2750.32, currency: 'USD' };

      case 'notifications.publish':
        return {
          delivered: true,
          payload: request.params,
        };

      default:
        throw new Error(`Unknown method: ${request.method}`);
    }
  };
}

function mapToRecord(results: Map<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(results.entries());
}

async function runResumeFromPersistedState() {
  const persistedState: PersistedState = {
    context: {
      accountId: 'acct-1001',
    },
    stepResults: {
      loadAccount: {
        result: {
          id: 'acct-1001',
          tier: 'gold',
        },
      },
    },
  };

  const executor = new FlowExecutor(flow, createMockHandler());

  // Seed context and prior results before resuming
  executor.setContext(persistedState.context);
  executor.setStepResults(persistedState.stepResults);

  const results = await executor.resume();

  return mapToRecord(results);
}

async function runRetryFromFailure() {
  const executor = new FlowExecutor(flow, createMockHandler());
  executor.setContext({ accountId: 'acct-1002' });

  try {
    await executor.execute();
  } catch (_error) {
    // Expected first failure from calculateBalance
  }

  const results = await executor.retry();

  return mapToRecord(results);
}

export async function runResumeRetryExample() {
  const resumed = await runResumeFromPersistedState();
  const retried = await runRetryFromFailure();

  return {
    resumed,
    retried,
  };
}

if (require.main === module) {
  runResumeRetryExample()
    .then((value) => {
      console.log('Resume/retry example result:', JSON.stringify(value, null, 2));
    })
    .catch((error) => {
      console.error('Resume/retry example failed:', error);
      process.exitCode = 1;
    });
}

export { flow };
