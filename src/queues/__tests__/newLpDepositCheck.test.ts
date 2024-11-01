import { describe, it, expect, vi, afterEach } from 'vitest';
import checkForFirstNewLpDeposits, { getLatestDepositId } from '../../queries/liquidityDeposits.js';
import { config } from '../newLpDepositCheck.js';

vi.mock('../../queries/liquidityDeposits.js');

describe('newLpDepositCheck', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe('initialize', () => {
    it('queues the job', async () => {
      vi.mocked(getLatestDepositId).mockResolvedValueOnce(1);
      const queue = { add: vi.fn() };

      await config.initialize?.(queue as any);

      expect(queue.add.mock.calls).toMatchInlineSnapshot(`
        [
          [
            "newLpDepositCheck",
            {
              "lastCheckedDepositId": 1,
            },
            {
              "deduplication": {
                "id": "newLpDepositCheck",
              },
              "delay": 30000,
            },
          ],
        ]
      `);
    });
  });

  describe('processJob', () => {
    it('processes a job', async () => {
      vi.mocked(getLatestDepositId).mockResolvedValueOnce(10);
      vi.mocked(checkForFirstNewLpDeposits).mockResolvedValueOnce([
        {
          asset: 'ETH',
          depositAmount: '1.523',
          depositValueUsd: '999',
          lpIdSs58: 'cf123test',
        },
      ]);

      const dispatchJobs = vi.fn();

      await config.processJob(dispatchJobs)({ data: { lastSwapRequestId: 10 } } as any);

      expect(dispatchJobs.mock.calls).toMatchInlineSnapshot(`
        [
          [
            [
              {
                "data": [
                  {
                    "data": {
                      "lastCheckedDepositId": 10,
                    },
                    "name": "newLpDepositCheck",
                    "opts": {
                      "deduplication": {
                        "id": "newLpDepositCheck",
                      },
                      "delay": 30000,
                    },
                  },
                ],
                "name": "scheduler",
              },
              {
                "data": {
                  "channel": "telegram",
                  "message": "💸 New Liquidity Provider Detected!
        <strong>cf12…test</strong> deposited 1.523 ETH ($999.00) 🍾",
                  "messageType": "NEW_LP",
                },
                "name": "messageRouter",
              },
              {
                "data": {
                  "channel": "discord",
                  "message": "💸 New Liquidity Provider Detected!
        **cf12…test** deposited 1.523 ETH ($999.00) 🍾",
                  "messageType": "NEW_LP",
                },
                "name": "messageRouter",
              },
            ],
          ],
        ]
      `);
    });
  });
});