import { CandleChartInterval } from 'binance-api-node';
import { tickExitStrategy } from '../strategies/exit';
import { Complex } from '../strategies/entry';
import { getPositionSizeByRisk } from '../strategies/riskManagement';

export const hyperParameters = {
  // ADX - Trend Strength
  adxType: { value: 'MASANAKAMURA' },
  adxLength: { value: 21 },
  adxThreshold: { value: 25 },

  // Support/Resistance
  supportResistanceLeftBars: { value: 8 },
  supportResistanceRightBars: { value: 8 },

  // Volume Analysis
  volumeMultiplier: { value: 2.0 },
  volumeLength: { value: 20 },

  // PSAR for Trend Direction
  psarStep: { value: 0.02 },
  psarMax: { value: 0.2 },

  // Range Filter for Volatility
  rangeFilterSourceType: { value: 'close' },
  rangeFilterPeriod: { value: 10 },
  rangeFilterMultiplier: { value: 1.5 },

  // MACD for Momentum
  macdFastLength: { value: 12 },
  macdSlowLength: { value: 26 },
  macdSourceType: { value: 'close' },
  macdSignalLength: { value: 9 },

  // RSI Settings
  rsiLength: { value: 14 },
  rsiSourceType: { value: 'close' },
  rsiOversold: { value: 35 },
  rsiOverbought: { value: 65 },

  // Momentum
  momentumLength: { value: 10 },
  momentumTmoLength: { value: 3 },
  momentumSmoothLength: { value: 21 },

  // Moving Averages
  maLength: { value: 21 },
  maSourceType: { value: 'close' },
  jmaLength: { value: 14 },
  jmaSourceType: { value: 'close' },

  // Scalping Parameters
  emaScalpingLength: { value: 5 },
  scalpingFastEmaLength: { value: 8 },
  scalpingMediumEmaLength: { value: 89 },
  scalpingSlowEmaLength: { value: 200 },
  scalpingLookBack: { value: 10 },
  scalpingUseHeikinAshiCandles: { value: true },

  // RMI Settings
  rmiLength: { value: 21 },
  rmiSourceType: { value: 'close' },
  rmiMomentumLength: { value: 10 },
  rmiOversold: { value: 40 },
  rmiOverbought: { value: 60 },

  // Bollinger Bands
  bollingerBandsLength: { value: 20 },
  bollingerBandsSourceType: { value: 'close' },
  bollingerBandsMultiplier: { value: 2.2 },

  // Risk Management - Fixed R:R with position limits
  tpLongPercent: { value: 0.015 },  // 1.5% take profit
  tpShortPercent: { value: 0.015 }, // 1.5% take profit
  slPercent: { value: 0.005 },      // 0.5% stop loss - 1:3 risk/reward
  maxPositionSize: { value: 0.1 },  // Max 10% of capital per trade
};

export const config: AbstractStrategyConfig = (parameters) => [
  {
    asset: 'BTC',
    base: 'USDT',
    loopInterval: CandleChartInterval.ONE_HOUR,
    indicatorIntervals: [CandleChartInterval.ONE_HOUR],
    risk: 0.005, // 0.5% risk per trade - more conservative
    leverage: 3,  // Lower leverage
    unidirectional: false,
    canOpenNewPositionToCloseLast: false,
    maxTradeDuration: 48, // Max 48 hours per trade
    allowPyramiding: false, // No pyramiding
    maxPyramidingAllocation: 0.2, // Max 20% total allocation if pyramiding enabled
    exitStrategy: (price, candles, pricePrecision, side, exchangeInfo) =>
      tickExitStrategy(
        price,
        candles[CandleChartInterval.ONE_HOUR],
        pricePrecision,
        side,
        exchangeInfo,
        {
          lossTolerance: parameters.slPercent.value,
          profitTargets: [
            {
              quantityPercentage: 0.5, // Take half profit at first target
              deltaPercentage: parameters.tpLongPercent.value,
            },
            {
              quantityPercentage: 0.3, // Scale out 30% at second target
              deltaPercentage: parameters.tpLongPercent.value * 1.5,
            },
            {
              quantityPercentage: 0.2, // Let 20% run with wider target
              deltaPercentage: parameters.tpLongPercent.value * 2,
            },
          ],
        }
      ),
    buyStrategy: (candles) =>
      Complex.BITCOIN_SNIPER_V1.isBuySignal(
        candles[CandleChartInterval.ONE_HOUR],
        {
          ...Object.entries(parameters).reduce(
            (prev, cur) => ({ [cur[0]]: cur[1].value, ...prev }),
            {}
          ),
        }
      ),
    sellStrategy: (candles) =>
      Complex.BITCOIN_SNIPER_V1.isSellSignal(
        candles[CandleChartInterval.ONE_HOUR],
        {
          ...Object.entries(parameters).reduce(
            (prev, cur) => ({ [cur[0]]: cur[1].value, ...prev }),
            {}
          ),
        }
      ),
    riskManagement: (options) => {
      // Get base position size from risk calculation
      const baseSize = getPositionSizeByRisk(options);
      
      // Apply maximum position size limit
      const maxSize = options.balance * parameters.maxPositionSize.value;
      return Math.min(baseSize, maxSize);
    },
  },
]; 