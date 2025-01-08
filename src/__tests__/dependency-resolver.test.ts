import { DependencyResolver } from '../dependency-resolver';
import { Flow } from '../types';
import { TestLogger } from '../util/logger';

describe('DependencyResolver', () => {
  let testLogger: TestLogger;

  beforeEach(() => {
    testLogger = new TestLogger('Test');
  });

  it('correctly identifies dependencies in request steps', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for request step dependencies',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: '${getUser.id}' },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, testLogger);
    expect(resolver.getDependencies('getFriends')).toEqual(['getUser']);
    expect(resolver.getDependencies('getUser')).toEqual([]);
    expect(resolver.getDependents('getUser')).toEqual(['getFriends']);
  });

  it('correctly identifies dependencies in loop steps', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for loop step dependencies',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: '${getUser.id}' },
          },
        },
        {
          name: 'notifyFriends',
          loop: {
            over: '${getFriends}',
            as: 'friend',
            condition: '${friend.id} > ${getUser.id}',
            step: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: {
                  userId: '${friend.id}',
                  message: 'Hello from ${getUser.name}!',
                },
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, testLogger);
    expect(resolver.getDependencies('notifyFriends')).toEqual(['getFriends', 'getUser']);
    expect(resolver.getExecutionOrder().map((s) => s.name)).toEqual([
      'getUser',
      'getFriends',
      'notifyFriends',
    ]);
  });

  it('correctly identifies dependencies in condition steps', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for condition step dependencies',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
        {
          name: 'notifyIfAdmin',
          condition: {
            if: '${getUser.role} === "admin"',
            then: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: { userId: '${getUser.id}' },
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, testLogger);
    expect(resolver.getDependencies('notifyIfAdmin')).toEqual(['getUser']);
  });

  it('detects circular dependencies', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for circular dependency detection',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test',
            params: { value: '${step2.value}' },
          },
        },
        {
          name: 'step2',
          request: {
            method: 'test',
            params: { value: '${step1.value}' },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, testLogger);
    expect(() => resolver.getExecutionOrder()).toThrow('Circular dependency detected');
  });

  it('handles complex dependency chains', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for complex dependency chains',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: '${getUser.id}' },
          },
        },
        {
          name: 'filterFriends',
          transform: {
            input: '${getFriends}',
            operations: [
              {
                type: 'filter',
                using: '${item.age} > ${getUser.age}',
              },
            ],
          },
        },
        {
          name: 'notifyFriends',
          loop: {
            over: '${filterFriends}',
            as: 'friend',
            step: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: { userId: '${friend.id}' },
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, testLogger);
    const order = resolver.getExecutionOrder().map((s) => s.name);
    expect(order).toEqual(['getUser', 'getFriends', 'filterFriends', 'notifyFriends']);
  });

  it('correctly handles loop variable dependencies', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for loop variable dependencies',
      steps: [
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: 1 },
          },
        },
        {
          name: 'notifyFriends',
          loop: {
            over: '${getFriends}',
            as: 'friend',
            step: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: {
                  userId: '${friend.id}',
                  message: 'Hello ${friend.name}!',
                },
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, testLogger);
    expect(resolver.getDependencies('notifyFriends')).toEqual(['getFriends']);
    expect(() => resolver.getExecutionOrder()).not.toThrow();
  });
});
