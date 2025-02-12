type AbstractStrategyConfig = (
  hyperParameters: HyperParameters
) => StrategyConfig[];

interface StrategyConfig {
  asset: string;
  base: string;
  loopInterval: CandleChartInterval; // The speed of the main loop, the robot look up the market every this interval
  indicatorIntervals: CandleChartInterval[]; // The intervals/time frames needed for the strategy
  leverage?: number;
  risk: number; // % of total balance to risk in a trade
  allowPyramiding?: boolean; // Allow cumulative longs/shorts to average the entry price
  maxPyramidingAllocation?: number; // Max allocation for a position in pyramiding (between 0 and 1)
  unidirectional?: boolean; // When take the profit, close the position instead of opening new position in futures
  tradingSessions?: TradingSession[]; // The robot trades only during these sessions
  maxTradeDuration?: number; // Max duration of a trade in the unit of the loopInterval
  canOpenNewPositionToCloseLast?: boolean; // can close the last open position even if tp and sl is placed
  buyStrategy: EntryStrategy;
  sellStrategy: EntryStrategy;
  exitStrategy?: ExitStrategy; // Placement of take profits and stop loss
  trendFilter?: TrendFilter; // Trend filter - If the trend is up, only take long, else take only short
  riskManagement: RiskManagement;
}

type CandlesDataMultiTimeFrames = {
  [timeFrame: CandleChartInterval]: CandleData[];
};

interface CandleData {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: Date;
  closeTime: Date;
  interval: CandleChartInterval;
}

type HyperParameters = {
  [parameterName: string]: HyperParameter;
};

type HyperParameter = {
  value: any /* The value of parameter */;
  optimizationStep?: number;
  optimization?:
    | [number, number] /* A range between two value */
    | number[] // Specified number value
    | string[]; // Specified string value
};

type EntryStrategy = (candles: CandlesDataMultiTimeFrames) => boolean;

type TakeProfit = { price: number; quantityPercentage: number }; // quantityPercentage = 0.1 => 10%

// Strategy for Take Profits and Stop Loss
type ExitStrategy = (
  price: number,
  candles?: CandlesDataMultiTimeFrames,
  pricePrecision: number,
  side: OrderSide, // type from binance api lib
  exchangeInfo: ExchangeInfo
) => {
  takeProfits?: TakeProfit[];
  stopLoss?: number;
};

type TrendFilter = (
  candles: CandlesDataMultiTimeFrames,
  options?: any
) => Trend;

type Trend = 1 | -1 | 0; // 1: up trend, -1: down trend, 0: neutral

interface RiskManagementOptions {
  asset: string;
  base: string;
  balance: number;
  risk: number;
  enterPrice: number;
  stopLossPrice?: number;
  exchangeInfo: ExchangeInfo;
  leverage?: number;
}
type RiskManagement = (options: RiskManagementOptions) => number; // Return the size of the position

type TradingSession = {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 (Sunday) to 6 (Saturday)
  start: { hour: number; minute: number };
  end: { hour: number; minute: number };
};
