import { differenceInMinutes } from 'date-fns';
import { renderToStaticMarkup } from 'react-dom/server';
import { DispatchJobArgs, JobConfig, JobProcessor } from './initialize.js';
import { Bold, ExplorerLink } from '../channels/formatting.js';
import { platforms } from '../config.js';
import { humanFriendlyAsset } from '../consts.js';
import env from '../env.js';
import getSwapInfo from '../queries/getSwapInfo.js';
import logger from '../utils/logger.js';
import { formatUsdValue } from '../utils/strings.js';

const name = 'swapStatusCheck';
type Name = typeof name;

type Data = {
  swapRequestId: string;
};

type SwapInfo = Awaited<ReturnType<typeof getSwapInfo>>;

declare global {
  interface JobData {
    [name]: Data;
  }
}

const isFresh = (swapInfo: SwapInfo) => {
  const completedAtTimestamp = swapInfo?.completedAt;

  if (!completedAtTimestamp) return false;

  return (
    differenceInMinutes(new Date(), Date.parse(completedAtTimestamp)) <= env.SWAP_MAX_AGE_IN_MINUTES
  );
};

const getSwapStatus = (swapInfo: SwapInfo) => {
  if (swapInfo.completedEventId) return isFresh(swapInfo) ? 'fresh' : 'stale';

  return 'pending';
};

const emoji = (depositValueUsd: number) => {
  if (depositValueUsd > 100_000) return '🐳';
  if (depositValueUsd > 50_000) return '🦈';
  if (depositValueUsd > 25_000) return '🐟';
  if (depositValueUsd > 10_000) return '🦀';
  return '🦐';
};

const formatDeltaPrice = (value: string, deltaSign: boolean) => {
  return deltaSign ? '-' + value : value;
};

const deltaSign = (delta: number) => {
  if (delta <= -10) return '🔴';
  if (delta < -1) return '⚪️';
  return '🟢';
};

const buildMessageData = ({
  swapInfo,
}: {
  swapInfo: SwapInfo;
}): Extract<DispatchJobArgs, { name: 'messageRouter' }>[] =>
  platforms.map((platform) => {
    const message = renderToStaticMarkup(
      <>
        {emoji(Number(swapInfo.depositValueUsd))} Swap{' '}
        <Bold platform={platform}>
          <ExplorerLink platform={platform} path={`swaps/${swapInfo.requestId}`}>
            #{swapInfo.requestId}
          </ExplorerLink>
        </Bold>
        {'\n'}
        {swapInfo.depositAmount && swapInfo.depositValueUsd && (
          <>
            📥{' '}
            <Bold platform={platform}>
              {swapInfo.depositAmount} {humanFriendlyAsset[swapInfo.sourceAsset]}
            </Bold>{' '}
            ({formatUsdValue(swapInfo.depositValueUsd)}){'\n'}
          </>
        )}
        {swapInfo.egressAmount && swapInfo.egressValueUsd && (
          <>
            📤{' '}
            <Bold platform={platform}>
              {swapInfo.egressAmount} {humanFriendlyAsset[swapInfo.destinationAsset]}
            </Bold>{' '}
            ({formatUsdValue(swapInfo.egressValueUsd)}){'\n'}
          </>
        )}
        {swapInfo.duration && (
          <>
            ⏱️ Took: <Bold platform={platform}>{swapInfo.duration}</Bold>
            {'\n'}
          </>
        )}
        {swapInfo.priceDelta && swapInfo.priceDeltaPercentage && (
          <>
            {deltaSign(Number(swapInfo.priceDeltaPercentage))} Delta:{' '}
            <Bold platform={platform}>
              {formatDeltaPrice(
                formatUsdValue(Math.abs(swapInfo.priceDelta)),
                Number(swapInfo.priceDeltaPercentage) < 0,
              )}
            </Bold>{' '}
            ({swapInfo.priceDeltaPercentage}%){'\n'}
          </>
        )}
        {swapInfo.dcaChunks && (
          <>
            📓 Chunks: <Bold platform={platform}>{swapInfo.dcaChunks}</Bold>
            {'\n'}
          </>
        )}
        {swapInfo.effectiveBoostFeeBps && swapInfo.boostFee && (
          <>
            ⚡ <Bold platform={platform}>Boosted </Bold> for{' '}
            <Bold platform={platform}>{formatUsdValue(swapInfo.boostFee.valueUsd)}</Bold>
            {'\n'}
          </>
        )}
        {swapInfo.brokerIdAndAlias && (
          <>
            🏦 via{' '}
            <Bold platform={platform}>
              <ExplorerLink
                platform={platform}
                path={`/brokers/${swapInfo.brokerIdAndAlias.brokerId}`}
              >
                {swapInfo.brokerIdAndAlias.alias}
              </ExplorerLink>
            </Bold>
            {'\n'}
          </>
        )}
      </>,
    );

    return {
      name: 'messageRouter' as const,
      data: {
        platform,
        message,
        filterData: { name: 'NEW_SWAP', usdValue: Number(swapInfo?.egressValueUsd || 0) },
      },
    };
  });

const processJob: JobProcessor<Name> = (dispatchJobs) => async (job) => {
  const swapInfo = await getSwapInfo(job.data.swapRequestId);
  logger.info(`Checking swap #${job.data.swapRequestId}`);

  const jobs = [] as DispatchJobArgs[];

  if (swapInfo.completedEventId && Number(swapInfo.egressAmount) === 0) {
    logger.info(`Swap egress amount is zero, so it was refunded`);
    return;
  }

  const status = getSwapStatus(swapInfo);

  switch (status) {
    case 'fresh':
      jobs.push(...buildMessageData({ swapInfo }));
      logger.info(`Swap #${swapInfo.requestId} is fresh, job was added in a queue`);
      break;

    case 'stale':
      logger.warn(`Swap #${swapInfo.requestId} is stale`);
      break;

    case 'pending':
      jobs.push({
        name: 'scheduler',
        data: [{ name, data: { swapRequestId: job.data.swapRequestId }, opts: { delay: 10_000 } }],
      } as const);
      logger.info(`Swap #${swapInfo.requestId} is not completed, pushed to a scheduler`);
      break;
  }

  await dispatchJobs(jobs);
};

export const config: JobConfig<typeof name> = {
  name,
  processJob,
};
