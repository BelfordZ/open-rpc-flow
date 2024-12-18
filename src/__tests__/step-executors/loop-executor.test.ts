import { LoopStepExecutor, isLoopResult } from '../../step-executors';
import { 
  StepExecutionContext, 
  LoopStep, 
  StepExecutionResult, 
  StepType,
  LoopStepResult,
  LoopResult
} from '../../step-executors/types';
import { createMockContext } from '../test-utils';
import { ExpressionEvaluator } from '../../expression-evaluator';
import { ReferenceResolver } from '../../reference-resolver';

interface TestResult {
  success: boolean;
  teamId?: number;
  memberId?: number;
}

interface TestMember {
  id: number;
}

interface TestTeam {
  id: number;
  members: TestMember[];
}

describe('LoopStepExecutor', () => {
  let executor: LoopStepExecutor<TestResult>;
  let context: StepExecutionContext;
  let executeStep: jest.Mock;
  let stepResults: Map<string, any>;

  beforeEach(() => {
    executeStep = jest.fn();
    executor = new LoopStepExecutor<TestResult>(executeStep);
    stepResults = new Map();
    const referenceResolver = new ReferenceResolver(stepResults, {});
    const expressionEvaluator = new ExpressionEvaluator(referenceResolver, {});
    context = {
      referenceResolver,
      expressionEvaluator,
      transformExecutor: null as any,
      stepResults,
      context: {}
    };
    // Add spies to the real expression evaluator
    jest.spyOn(context.expressionEvaluator, 'evaluateExpression');
  });

  it('executes a simple loop over array', async () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    stepResults.set('items', items);

    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        step: {
          name: 'processItem',
          request: {
            method: 'item.process',
            params: {
              id: '${item.id}'
            }
          }
        }
      }
    };

    executeStep.mockResolvedValue({ result: { success: true }, type: StepType.Request });
    const result = await executor.execute(step, context);

    expect(isLoopResult<TestResult>(result)).toBe(true);
    expect(result.type).toBe(StepType.Loop);
    expect(result.result.value).toHaveLength(3);
    expect(result.result.iterationCount).toBe(3);
    expect(result.result.skippedCount).toBe(0);
    expect(executeStep).toHaveBeenCalledTimes(3);
    
    // Verify expression evaluator calls
    expect(context.expressionEvaluator.evaluateExpression)
      .toHaveBeenCalledWith('${items}', expect.any(Object));
  });

  it('handles nested loops', async () => {
    const teams = [
      { id: 1, members: [{ id: 1 }, { id: 2 }] },
      { id: 2, members: [{ id: 3 }, { id: 4 }] }
    ];
    stepResults.set('teams', teams);

    const step: LoopStep = {
      name: 'processTeams',
      loop: {
        over: '${teams}',
        as: 'team',
        maxIterations: 2,
        step: {
          name: 'processMembers',
          loop: {
            over: '${team.members}',
            as: 'member',
            maxIterations: 2,
            step: {
              name: 'processMember',
              request: {
                method: 'member.process',
                params: {
                  teamId: '${team.id}',
                  memberId: '${member.id}'
                }
              }
            }
          }
        }
      }
    };

    // Mock inner loop results
    executeStep.mockImplementation(async (step: any, context: any) => {
      if (step.name === 'processMembers') {
        const teamMembers = context.team.members as TestMember[];
        const maxIterations = step.loop.maxIterations ?? teamMembers.length;
        const innerResults = teamMembers.slice(0, maxIterations).map((member: TestMember) => ({
          success: true,
          teamId: context.team.id,
          memberId: member.id
        }));
        return {
          type: StepType.Loop,
          result: {
            value: innerResults,
            iterationCount: maxIterations,
            skippedCount: 0
          }
        } as LoopStepResult<TestResult>;
      }
      return { result: { success: true }, type: StepType.Request } as StepExecutionResult<TestResult>;
    });

    const result = await executor.execute(step, context);
    expect(isLoopResult<TestResult>(result)).toBe(true);
    const typedResult = result as LoopStepResult<TestResult>;

    expect(typedResult.type).toBe(StepType.Loop);
    expect(typedResult.result.value).toHaveLength(2);
    expect(typedResult.result.iterationCount).toBe(2);
    expect(typedResult.result.skippedCount).toBe(0);
    expect(executeStep).toHaveBeenCalledTimes(2);

    // Each inner loop result should have 2 items due to maxIterations
    const innerResults = typedResult.result.value;
    expect(innerResults[0]).toEqual({
      value: [
        {
          success: true,
          teamId: 1,
          memberId: 1
        },
        {
          success: true,
          teamId: 1,
          memberId: 2
        }
      ],
      iterationCount: 2,
      skippedCount: 0
    });

    expect(innerResults[1]).toEqual({
      value: [
        {
          success: true,
          teamId: 2,
          memberId: 3
        },
        {
          success: true,
          teamId: 2,
          memberId: 4
        }
      ],
      iterationCount: 2,
      skippedCount: 0
    });
  });

  it('handles empty arrays', async () => {
    stepResults.set('items', []);

    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        step: {
          name: 'processItem',
          request: {
            method: 'item.process',
            params: {
              id: '${item.id}'
            }
          }
        }
      }
    };

    const result = await executor.execute(step, context);

    expect(result.type).toBe('loop');
    expect(result.result.value).toHaveLength(0);
    expect(result.result.iterationCount).toBe(0);
    expect(result.result.skippedCount).toBe(0);
    expect(executeStep).not.toHaveBeenCalled();

    // Verify expression evaluator calls
    expect(context.expressionEvaluator.evaluateExpression)
      .toHaveBeenCalledWith('${items}', expect.any(Object));
  });

  it('provides iteration index in context', async () => {
    const items = [{ id: 1 }, { id: 2 }];
    stepResults.set('items', items);

    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        step: {
          name: 'processItem',
          request: {
            method: 'item.process',
            params: {
              id: '${item.id}',
              index: '${$index}'
            }
          }
        }
      }
    };

    executeStep.mockResolvedValue({ result: { success: true }, type: 'request' });
    await executor.execute(step, context);

    // Verify the context passed to executeStep
    expect(executeStep).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        item: items[0],
        $index: 0
      })
    );

    expect(executeStep).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        item: items[1],
        $index: 1
      })
    );

    // Verify expression evaluator calls
    expect(context.expressionEvaluator.evaluateExpression)
      .toHaveBeenCalledWith('${items}', expect.any(Object));
  });

  it('throws error for non-array input', async () => {
    stepResults.set('nonArray', { key: 'value' });

    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${nonArray}',
        as: 'item',
        step: {
          name: 'processItem',
          request: {
            method: 'item.process',
            params: {}
          }
        }
      }
    };

    await expect(executor.execute(step, context)).rejects.toThrow('must evaluate to an array');
    
    // Verify expression evaluator calls
    expect(context.expressionEvaluator.evaluateExpression)
      .toHaveBeenCalledWith('${nonArray}', expect.any(Object));
  });

  it('respects maxIterations limit', async () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    stepResults.set('items', items);

    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        maxIterations: 2,
        step: {
          name: 'processItem',
          request: {
            method: 'item.process',
            params: {
              id: '${item.id}'
            }
          }
        }
      }
    };

    executeStep.mockResolvedValue({ result: { success: true }, type: 'request' });
    const result = await executor.execute(step, context);

    expect(result.type).toBe('loop');
    expect(result.result.value).toHaveLength(2); // Should only process 2 items due to maxIterations
    expect(result.result.iterationCount).toBe(2); // Should count only processed iterations
    expect(result.result.skippedCount).toBe(0);
    expect(executeStep).toHaveBeenCalledTimes(2);
    
    // Verify that only the first two items were processed
    expect(executeStep).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        item: items[0],
        $index: 0
      })
    );
    expect(executeStep).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        item: items[1],
        $index: 1
      })
    );
  });

  it('respects maxIterations in nested loops', async () => {
    const teams = [
      { id: 1, members: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      { id: 2, members: [{ id: 4 }, { id: 5 }, { id: 6 }] },
      { id: 3, members: [{ id: 7 }, { id: 8 }, { id: 9 }] }
    ];
    stepResults.set('teams', teams);

    const step: LoopStep = {
      name: 'processTeams',
      loop: {
        over: '${teams}',
        as: 'team',
        maxIterations: 2,
        step: {
          name: 'processMembers',
          loop: {
            over: '${team.members}',
            as: 'member',
            maxIterations: 2,
            step: {
              name: 'processMember',
              request: {
                method: 'member.process',
                params: {
                  teamId: '${team.id}',
                  memberId: '${member.id}'
                }
              }
            }
          }
        }
      }
    };

    // Mock inner loop results
    executeStep.mockImplementation(async (step: any, context: any) => {
      if (step.name === 'processMembers') {
        const teamMembers = context.team.members as TestMember[];
        const maxIterations = step.loop.maxIterations ?? teamMembers.length;
        const innerResults = teamMembers.slice(0, maxIterations).map((member: TestMember) => ({
          success: true,
          teamId: context.team.id,
          memberId: member.id
        }));
        return {
          type: StepType.Loop,
          result: {
            value: innerResults,
            iterationCount: maxIterations,
            skippedCount: 0
          }
        } as LoopStepResult<TestResult>;
      }
      return { result: { success: true }, type: StepType.Request } as StepExecutionResult<TestResult>;
    });

    const result = await executor.execute(step, context);
    expect(isLoopResult<TestResult>(result)).toBe(true);
    const typedResult = result as LoopStepResult<TestResult>;

    expect(typedResult.type).toBe(StepType.Loop);
    expect(typedResult.result.value).toHaveLength(2);
    expect(typedResult.result.iterationCount).toBe(2);
    expect(typedResult.result.skippedCount).toBe(0);
    expect(executeStep).toHaveBeenCalledTimes(2);

    // Each inner loop result should have 2 items due to maxIterations
    const innerResults = typedResult.result.value;
    expect(innerResults[0]).toEqual({
      value: [
        {
          success: true,
          teamId: 1,
          memberId: 1
        },
        {
          success: true,
          teamId: 1,
          memberId: 2
        }
      ],
      iterationCount: 2,
      skippedCount: 0
    });

    expect(innerResults[1]).toEqual({
      value: [
        {
          success: true,
          teamId: 2,
          memberId: 4
        },
        {
          success: true,
          teamId: 2,
          memberId: 5
        }
      ],
      iterationCount: 2,
      skippedCount: 0
    });
  });

  it('combines maxIterations with condition', async () => {
    const items = [{ id: 1, valid: true }, { id: 2, valid: false }, { id: 3, valid: true }, { id: 4, valid: true }];
    stepResults.set('items', items);

    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        maxIterations: 3,
        condition: '${item.valid}',
        step: {
          name: 'processItem',
          request: {
            method: 'item.process',
            params: {
              id: '${item.id}'
            }
          }
        }
      }
    };

    executeStep.mockResolvedValue({ result: { success: true }, type: 'request' });
    const result = await executor.execute(step, context);

    expect(result.type).toBe('loop');
    expect(result.result.value).toHaveLength(2); // Should process 2 valid items within maxIterations
    expect(result.result.iterationCount).toBe(3); // Should count all iterations within maxIterations
    expect(result.result.skippedCount).toBe(1); // Should count skipped items within maxIterations
    expect(executeStep).toHaveBeenCalledTimes(2);
  });
}); 