import { LoopStepExecutor } from '../../step-executors';
import {
  LoopStep,
  StepExecutionResult,
  StepType,
  LoopResult,
  isLoopResult,
} from '../../step-executors/types';
import { StepExecutionContext } from '../../types';

import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../../reference-resolver';
import { noLogger } from '../../util/logger';

interface TestResult {
  success: boolean;
  teamId?: number;
  memberId?: number;
}

interface TestMember {
  id: number;
}

describe('LoopStepExecutor', () => {
  let executor: LoopStepExecutor;
  let context: StepExecutionContext;
  let executeStep: jest.Mock;
  let stepResults: Map<string, any>;

  beforeEach(() => {
    executeStep = jest.fn();
    executor = new LoopStepExecutor(executeStep, noLogger);
    stepResults = new Map();
    const referenceResolver = new ReferenceResolver(stepResults, {}, noLogger);
    const expressionEvaluator = new SafeExpressionEvaluator(noLogger, referenceResolver);
    context = {
      referenceResolver,
      expressionEvaluator,
      stepResults,
      context: {},
      logger: noLogger,
    };
    // Add spies to the real expression evaluator
    jest.spyOn(context.expressionEvaluator, 'evaluate');
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
              id: '${item.id}',
            },
          },
        },
      },
    };

    executeStep.mockResolvedValue({ type: StepType.Request, result: { success: true } });
    const result = await executor.execute(step, context);

    expect(isLoopResult<TestResult>(result)).toBe(true);
    expect(result.type).toBe(StepType.Loop);
    expect(result.result!.value).toHaveLength(3);
    expect(result.result!.iterationCount).toBe(3);
    expect(result.result!.skippedCount).toBe(0);
    expect(executeStep).toHaveBeenCalledTimes(3);

    // Verify expression evaluator calls
    expect(context.expressionEvaluator.evaluate).toHaveBeenCalledWith(
      '${items}',
      expect.any(Object),
    );
  });

  it('handles nested loops', async () => {
    const teams = [
      { id: 1, members: [{ id: 1 }, { id: 2 }] },
      { id: 2, members: [{ id: 3 }, { id: 4 }] },
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
                  memberId: '${member.id}',
                },
              },
            },
          },
        },
      },
    };

    // Mock inner loop results
    executeStep.mockImplementation(
      async (step: any, context: any): Promise<StepExecutionResult> => {
        if (step.name === 'processMembers') {
          const teamMembers = context.team.members as TestMember[];
          const maxIterations = step.loop.maxIterations ?? teamMembers.length;
          const innerResults = teamMembers.slice(0, maxIterations).map((member: TestMember) => ({
            success: true,
            teamId: context.team.id,
            memberId: member.id,
          }));
          const loopResult: LoopResult<TestResult> = {
            value: innerResults,
            iterationCount: maxIterations,
            skippedCount: 0,
          };
          return {
            type: StepType.Loop,
            result: loopResult,
          };
        }
        return {
          type: StepType.Request,
          result: { success: true },
        };
      },
    );

    const result = await executor.execute(step, context);
    expect(isLoopResult<TestResult>(result)).toBe(true);
    expect(result.type).toBe(StepType.Loop);
    expect(result.result!.value).toHaveLength(2);
    expect(result.result!.iterationCount).toBe(2);
    expect(result.result!.skippedCount).toBe(0);
    expect(executeStep).toHaveBeenCalledTimes(2);

    // Each inner loop result should have 2 items due to maxIterations
    const innerResults = result.result!.value;
    expect(innerResults[0].result).toEqual({
      value: [
        {
          success: true,
          teamId: 1,
          memberId: 1,
        },
        {
          success: true,
          teamId: 1,
          memberId: 2,
        },
      ],
      iterationCount: 2,
      skippedCount: 0,
    });

    expect(innerResults[1].result).toEqual({
      value: [
        {
          success: true,
          teamId: 2,
          memberId: 3,
        },
        {
          success: true,
          teamId: 2,
          memberId: 4,
        },
      ],
      iterationCount: 2,
      skippedCount: 0,
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
              id: '${item.id}',
            },
          },
        },
      },
    };

    const result = await executor.execute(step, context);

    expect(result.type).toBe(StepType.Loop);
    expect(result.result!.value).toHaveLength(0);
    expect(result.result!.iterationCount).toBe(0);
    expect(result.result!.skippedCount).toBe(0);
    expect(executeStep).not.toHaveBeenCalled();

    // Verify expression evaluator calls
    expect(context.expressionEvaluator.evaluate).toHaveBeenCalledWith(
      '${items}',
      expect.any(Object),
    );
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
              index: '${metadata.iteration.index}',
            },
          },
        },
      },
    };

    const mockRequestStepResult: StepExecutionResult = {
      result: { success: true },
      type: StepType.Request,
      metadata: { method: 'item.process' },
    };
    executeStep.mockResolvedValue(mockRequestStepResult);
    await executor.execute(step, context);

    const iterationHistory = [
      {
        index: 0,
        count: 1,
        total: items.length,
        maxIterations: items.length,
        isFirst: true,
        isLast: false,
        value: items[0],
      },
      {
        index: 1,
        count: 2,
        total: items.length,
        maxIterations: items.length,
        isFirst: false,
        isLast: true,
        value: items[1],
      },
    ];

    // Verify the context passed to executeStep
    expect(executeStep).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        item: items[0],
        metadata: {
          iteration: [iterationHistory[0]],
          current: iterationHistory[0],
        },
      }),
    );

    expect(executeStep).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        item: items[1],
        metadata: {
          iteration: iterationHistory,
          current: iterationHistory[1],
        },
      }),
    );

    // Verify expression evaluator calls
    expect(context.expressionEvaluator.evaluate).toHaveBeenCalledWith(
      '${items}',
      expect.any(Object),
    );
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
            params: {},
          },
        },
      },
    };

    await expect(executor.execute(step, context)).rejects.toThrow(
      'Failed to execute loop step "processItems": Loop "over" value must resolve to an array',
    );

    // Verify expression evaluator calls
    expect(context.expressionEvaluator.evaluate).toHaveBeenCalled();
  });

  it('respects maxIterations limit', async () => {
    const maxIterations = 2;
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    stepResults.set('items', items);

    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        maxIterations,
        step: {
          name: 'processItem',
          request: {
            method: 'item.process',
            params: {
              id: '${item.id}',
            },
          },
        },
      },
    };

    executeStep.mockResolvedValue({ type: StepType.Request, result: { success: true } });
    const result = await executor.execute(step, context);

    expect(result.type).toBe(StepType.Loop);
    expect(result.result!.value).toHaveLength(2); // Should only process 2 items due to maxIterations
    expect(result.result!.iterationCount).toBe(2); // Should count only processed iterations
    expect(result.result!.skippedCount).toBe(2); // Should all skipped items (maxIterations)
    expect(executeStep).toHaveBeenCalledTimes(2);

    const iterationHistory = [
      {
        index: 0,
        count: 1,
        total: items.length,
        maxIterations,
        isFirst: true,
        isLast: false,
        value: items[0],
      },
      {
        index: 1,
        count: 2,
        total: items.length,
        maxIterations,
        isFirst: false,
        isLast: true,
        value: items[1],
      },
    ];

    // Verify that only the first two items were processed
    expect(executeStep).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        item: items[0],
        metadata: {
          iteration: [iterationHistory[0]],
          current: iterationHistory[0],
        },
      }),
    );
    expect(executeStep).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        item: items[1],
        metadata: {
          iteration: iterationHistory,
          current: iterationHistory[1],
        },
      }),
    );
  });

  it('respects maxIterations in nested loops', async () => {
    const teams = [
      { id: 1, members: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      { id: 2, members: [{ id: 4 }, { id: 5 }, { id: 6 }] },
      { id: 3, members: [{ id: 7 }, { id: 8 }, { id: 9 }] },
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
                  memberId: '${member.id}',
                },
              },
            },
          },
        },
      },
    };

    // Mock inner loop results
    executeStep.mockImplementation(
      async (step: any, context: any): Promise<StepExecutionResult> => {
        if (step.name === 'processMembers') {
          const teamMembers = context.team.members as TestMember[];
          const maxIterations = step.loop.maxIterations ?? teamMembers.length;
          const innerResults = teamMembers.slice(0, maxIterations).map((member: TestMember) => ({
            success: true,
            teamId: context.team.id,
            memberId: member.id,
          }));
          const loopResult: LoopResult<TestResult> = {
            value: innerResults,
            iterationCount: maxIterations,
            skippedCount: 0,
          };
          return {
            type: StepType.Loop,
            result: loopResult,
          };
        }
        return {
          type: StepType.Request,
          result: { success: true },
        };
      },
    );

    const result = await executor.execute(step, context);
    expect(isLoopResult<TestResult>(result)).toBe(true);
    expect(result.type).toBe(StepType.Loop);
    expect(result.result!.value).toHaveLength(2);
    expect(result.result!.iterationCount).toBe(2);
    expect(result.result!.skippedCount).toBe(1);
    expect(executeStep).toHaveBeenCalledTimes(2);

    // Each inner loop result should have 2 items due to maxIterations
    const innerResults = result.result!.value;
    expect(innerResults[0].result).toEqual({
      value: [
        {
          success: true,
          teamId: 1,
          memberId: 1,
        },
        {
          success: true,
          teamId: 1,
          memberId: 2,
        },
      ],
      iterationCount: 2,
      skippedCount: 0,
    });

    expect(innerResults[1].result).toEqual({
      value: [
        {
          success: true,
          teamId: 2,
          memberId: 4,
        },
        {
          success: true,
          teamId: 2,
          memberId: 5,
        },
      ],
      iterationCount: 2,
      skippedCount: 0,
    });
  });

  it('combines maxIterations with condition', async () => {
    const items = [
      { id: 1, valid: true },
      { id: 2, valid: false },
      { id: 3, valid: true },
      { id: 4, valid: true },
    ];
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
              id: '${item.id}',
            },
          },
        },
      },
    };

    executeStep.mockResolvedValue({ type: StepType.Request, result: { success: true } });
    const result = await executor.execute(step, context);

    expect(result.type).toBe('loop');
    expect(result.result!.value).toHaveLength(2); // Should process 2 valid items within maxIterations
    expect(result.result!.iterationCount).toBe(3); // Should count all iterations within maxIterations
    expect(result.result!.skippedCount).toBe(2); // Should all skipped items (condiiton not met + skipped due to maxIterations)
    expect(executeStep).toHaveBeenCalledTimes(2);
  });

  it('throws error when given invalid step type', async () => {
    const invalidStep = {
      name: 'invalidStep',
      request: {
        // This makes it a RequestStep instead of a LoopStep
        method: 'some.method',
        params: {},
      },
    };

    await expect(executor.execute(invalidStep as any, context)).rejects.toThrow(
      'Invalid step type for LoopStepExecutor',
    );
  });

  it('throws error when neither step nor steps is defined', async () => {
    const invalidStep: LoopStep = {
      name: 'invalidLoop',
      loop: {
        over: '${items}',
        as: 'item',
        // Intentionally omitting both step and steps
      },
    };

    await expect(executor.execute(invalidStep, context)).rejects.toThrow(
      'Loop must have either step or steps defined',
    );
  });

  it('executes multiple steps in a loop iteration', async () => {
    const items = [{ id: 1 }, { id: 2 }];
    stepResults.set('items', items);

    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        steps: [
          {
            name: 'validateItem',
            request: {
              method: 'item.validate',
              params: {
                id: '${item.id}',
              },
            },
          },
          {
            name: 'processItem',
            request: {
              method: 'item.process',
              params: {
                id: '${item.id}',
              },
            },
          },
        ],
      },
    };

    const mockValidateResult: StepExecutionResult = {
      type: StepType.Request,
      result: { valid: true },
      metadata: { method: 'item.validate' },
    };

    const mockProcessResult: StepExecutionResult = {
      type: StepType.Request,
      result: { success: true },
      metadata: { method: 'item.process' },
    };

    executeStep
      .mockResolvedValueOnce(mockValidateResult)
      .mockResolvedValueOnce(mockProcessResult)
      .mockResolvedValueOnce(mockValidateResult)
      .mockResolvedValueOnce(mockProcessResult);

    const result = await executor.execute(step, context);

    expect(result.type).toBe(StepType.Loop);
    expect(result.result!.value).toHaveLength(2); // Two iterations
    expect(result.result!.iterationCount).toBe(2);
    expect(result.result!.skippedCount).toBe(0);

    // Each iteration should have executed both steps
    expect(result.result!.value[0].result.value).toEqual([mockValidateResult, mockProcessResult]);
    expect(result.result!.value[1].result.value).toEqual([mockValidateResult, mockProcessResult]);

    // Should have been called 4 times total (2 steps × 2 iterations)
    expect(executeStep).toHaveBeenCalledTimes(4);

    // Verify the context for each step execution
    expect(executeStep).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'validateItem' }),
      expect.objectContaining({ item: items[0] }),
    );
    expect(executeStep).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'processItem' }),
      expect.objectContaining({ item: items[0] }),
    );
    expect(executeStep).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'validateItem' }),
      expect.objectContaining({ item: items[1] }),
    );
    expect(executeStep).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'processItem' }),
      expect.objectContaining({ item: items[1] }),
    );
  });
});
