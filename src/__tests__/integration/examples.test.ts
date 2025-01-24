import { FlowExecutor } from '../../flow-executor';
import { Flow } from '../../types';
import { createMockJsonRpcHandler } from '../test-utils';
import { noLogger } from '../../util/logger';
import * as fs from 'fs';
import * as path from 'path';

describe('Example Flows Integration', () => {
  let jsonRpcHandler: jest.Mock;

  beforeEach(() => {
    jsonRpcHandler = createMockJsonRpcHandler();
  });

  // Mock responses for different methods
  const setupMockResponses = (handler: jest.Mock) => {
    handler.mockImplementation((request) => {
      switch (request.method) {
        case 'orders.list':
          return Promise.resolve([
            { id: 1, total: 1500, status: 'pending' },
            { id: 2, total: 800, status: 'pending' },
            { id: 3, total: 2000, status: 'pending' },
          ]);
        case 'user.get':
          return Promise.resolve({
            id: 1,
            name: 'John Doe',
            email: 'john@example.com',
            role: 'admin',
          });
        case 'permissions.get':
          return Promise.resolve({
            userId: 1,
            role: 'admin',
            permissions: ['read', 'write', 'delete'],
          });
        case 'teams.list':
          return Promise.resolve([
            {
              id: 1,
              name: 'Team A',
              members: [
                { id: 1, name: 'Member 1' },
                { id: 2, name: 'Member 2' },
              ],
            },
            {
              id: 2,
              name: 'Team B',
              members: [{ id: 3, name: 'Member 3' }],
            },
          ]);
        case 'notification.send':
          return Promise.resolve({ success: true, notificationId: '123' });
        case 'inventory.check':
          return Promise.resolve([
            {
              inStock: true,
              quantity: 15,
              productId: 123,
            },
            {
              inStock: false,
              quantity: 5,
              productId: 123,
            },
          ]);
        case 'orders.create':
          return Promise.resolve({
            orderId: 'ORD123',
            status: 'created',
          });
        case 'data.fetch':
          return Promise.resolve([
            { id: 1, value: 100, confidence: 0.9, timestamp: '2024-01-01T00:00:00Z' },
            { id: 2, value: 200, confidence: 0.85, timestamp: '2024-01-01T00:01:00Z' },
            { id: 3, value: 300, confidence: 0.75, timestamp: '2024-01-01T00:02:00Z' },
          ]);
        case 'analysis.process':
          return Promise.resolve({
            results: [{ id: 1, analysis: 'complete' }],
          });
        case 'results.store':
          return Promise.resolve({ success: true, storedAt: new Date().toISOString() });
        default:
          return Promise.resolve({ result: 'default' });
      }
    });
  };

  const loadExampleFlow = (filename: string): Flow => {
    const filePath = path.join(process.cwd(), 'examples', filename);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent);
  };

  const exampleFiles = fs
    .readdirSync(path.join(process.cwd(), 'examples'))
    .filter((file) => file.endsWith('.json'));

  describe.each(exampleFiles)('Example: %s', (filename) => {
    it('executes successfully', async () => {
      setupMockResponses(jsonRpcHandler);
      const flow = loadExampleFlow(filename);
      const executor = new FlowExecutor(flow, jsonRpcHandler, noLogger);

      const results = await executor.execute();

      // Verify that execution completed
      expect(results).toBeDefined();

      // Verify that all steps have results
      flow.steps.forEach((step) => {
        expect(results.get(step.name)).toBeDefined();
        expect(results.get(step.name).metadata.hasError).toBeFalsy();
      });

      // Example-specific validations
      switch (filename) {
        case '01-simple-request.json': {
          const getUser = results.get('getUser').result;
          expect(getUser.id).toBe(1);
          expect(getUser.role).toBe('admin');

          const getPermissions = results.get('getPermissions').result;
          expect(getPermissions.userId).toBe(1);
          expect(getPermissions.permissions).toBeInstanceOf(Array);
          break;
        }

        case '02-data-transformation.json': {
          const filterHighValue = results.get('filterHighValue').result;
          expect(Array.isArray(filterHighValue)).toBeTruthy();
          expect(filterHighValue.every((item: any) => item.total > 1000)).toBeTruthy();
          expect(filterHighValue.every((item: any) => item.priority === 'high')).toBeTruthy();
          expect(filterHighValue).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: 1, total: 1500, priority: 'high' }),
              expect.objectContaining({ id: 3, total: 2000, priority: 'high' }),
            ]),
          );

          const calculateTotal = results.get('calculateTotal').result;
          expect(typeof calculateTotal).toBe('number');
          expect(calculateTotal).toBe(3500); // 1500 + 2000
          break;
        }

        case '03-nested-loops.json': {
          const getTeams = results.get('getTeams').result;
          expect(Array.isArray(getTeams)).toBeTruthy();
          expect(getTeams).toHaveLength(2);

          const processTeams = results.get('processTeams').result;

          expect(processTeams.value).toHaveLength(2); // Two teams
          expect(processTeams.value[0].result.value).toHaveLength(2); // First team has 2 members
          expect(processTeams.value[1].result.value).toHaveLength(1); // Second team has 1 member

          // Verify notifications were sent
          const notifications = processTeams.value.flatMap((team: any) => team.result.value);
          expect(notifications).toHaveLength(3); // Total 3 members
          notifications.forEach((notification: any) => {
            expect(notification.result.success).toBeTruthy();
            expect(notification.result.notificationId).toBeDefined();
          });
          break;
        }

        case '04-conditional-branching.json': {
          const checkInventory = results.get('checkInventory').result;
          expect(checkInventory.length).toBeGreaterThan(0);
          expect(checkInventory[0].inStock).toBeTruthy();
          expect(checkInventory[0].quantity).toBeGreaterThanOrEqual(10);

          const processOrder = results.get('processOrder').result;
          expect(processOrder.type).toBe('transform');

          const notifyResult = results.get('notifyResult');
          expect(notifyResult.type).toBe('request');
          expect(notifyResult.metadata.hasError).toBeFalsy();
          break;
        }

        case '05-complex-data-pipeline.json': {
          const getRawData = results.get('getRawData').result;
          expect(Array.isArray(getRawData)).toBeTruthy();

          const cleanData = results.get('cleanData').result;
          expect(Array.isArray(cleanData)).toBeTruthy();
          expect(cleanData.every((item: any) => item.confidence >= 0.8)).toBeTruthy();

          const processBatches = results.get('processBatches').result;
          expect(Array.isArray(processBatches)).toBeTruthy();

          const analyzeBatches = results.get('analyzeBatches').result;
          expect(analyzeBatches.value).toBeDefined();

          const aggregateResults = results.get('aggregateResults').result;
          expect(Array.isArray(aggregateResults)).toBeTruthy();

          const storeResults = results.get('storeResults').result;
          expect(storeResults.success).toBeTruthy();
          expect(storeResults.storedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
          break;
        }
      }
    });
  });
});
