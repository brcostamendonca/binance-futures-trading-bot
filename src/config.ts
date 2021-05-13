import { CandleChartInterval } from 'binance-api-node';

// ============================ CONST =================================== //
export const MAX_SAVED_CANDLES = 30; // max candles for each crypto to store for analysis
export const MIN_FREE_BALANCE_FOR_SPOT_TRADING = 0;
export const MIN_FREE_BALANCE_FOR_FUTURE_TRADING = 0;

export const tradeConfigs: TradeConfig[] = [
  {
    asset: 'BTC',
    base: 'USDT',
    allocation: 0.01,
    lossTolerance: 0.03,
    profitTarget: 0.1,
    interval: CandleChartInterval.ONE_MINUTE,
    leverage: 2,
  },
];
