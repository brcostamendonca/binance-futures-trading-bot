import { CandleChartInterval } from 'binance-api-node';
import { tickExitStrategy } from '../strategies/exit';
import { getPositionSizeByRisk } from '../strategies/riskManagement';
import * as ExponentialGrowthSniper from '../strategies/entry/complex/exponentialGrowthSniper';

export const hyperParameters = {
  // ADX - Trend Strength (More balanced)
  adxType: { value: 'MASANAKAMURA' },
  adxLength: { value: 8 },            // Increased for more stability
  adxThreshold: { value: 15 },        // Lowered but not too low

  // Support/Resistance (More stable)
  supportResistanceLeftBars: { value: 4 },  // More bars for better S/R
  supportResistanceRightBars: { value: 4 },

  // Volume Analysis (More realistic)
  volumeMultiplier: { value: 1.1 },   // Increased volume requirement
  volumeLength: { value: 8 },         // Longer lookback

  // PSAR Settings (More balanced)
  psarStep: { value: 0.02 },          // More balanced PSAR
  psarMax: { value: 0.12 },

  // Range Filter (More stable)
  rangeFilterSourceType: { value: 'close' },
  rangeFilterPeriod: { value: 8 },      // Increased period
  rangeFilterMultiplier: { value: 1.1 }, // More significant filter

  // MACD Settings (More balanced)
  macdFastLength: { value: 8 },        // More balanced MACD
  macdSlowLength: { value: 17 },
  macdSourceType: { value: 'close' },
  macdSignalLength: { value: 5 },

  // RSI Settings (More balanced)
  rsiLength: { value: 8 },             // More balanced RSI
  rsiSourceType: { value: 'close' },

  // Momentum (More stable)
  momentumLength: { value: 6 },         // More balanced momentum
  momentumTmoLength: { value: 3 },
  momentumSmoothLength: { value: 5 },

  // Moving Averages (More stable)
  maLength: { value: 8 },              // More balanced MA
  maSourceType: { value: 'close' },
  jmaLength: { value: 6 },             // More balanced JMA
  jmaSourceType: { value: 'close' },

  // RMI Settings (More balanced)
  rmiLength: { value: 5 },             // More balanced RMI
  rmiSourceType: { value: 'close' },
  rmiMomentumLength: { value: 3 },
  rmiOversold: { value: 35 },         // Wider range but not too wide
  rmiOverbought: { value: 65 },       // Wider range but not too wide

  // Bollinger Bands (More stable)
  bollingerBandsLength: { value: 10 },  // More balanced BB
  bollingerBandsSourceType: { value: 'close' },
  bollingerBandsMultiplier: { value: 1.5 }, // More balanced multiplier

  // Risk Management (Protected growth)
  tpLongPercent: { value: 0.005 },     // Keep the same
  tpShortPercent: { value: 0.005 },    // Keep the same
  slPercent: { value: 0.003 },         // Keep the same
  maxPositionSize: { value: 0.1 },    // Keep the same
};

export const config: AbstractStrategyConfig = (parameters) => [
  {
    asset: 'BTC',
    base: 'USDT',
    loopInterval: CandleChartInterval.FIFTEEN_MINUTES,
    indicatorIntervals: [CandleChartInterval.FIFTEEN_MINUTES],
    risk: 0.01,                      // 1% risk per trade - conservative
    leverage: 3,                     // Moderate leverage
    allowPyramiding: false,          // Disable pyramiding for safer trading
    maxPyramidingAllocation: 0.20,   // Max 20% allocation with pyramiding
    unidirectional: false,
    canOpenNewPositionToCloseLast: true,
    exitStrategy: (price, candles, pricePrecision, side, exchangeInfo) =>
      tickExitStrategy(
        price,
        candles[CandleChartInterval.FIFTEEN_MINUTES],
        pricePrecision,
        side,
        exchangeInfo,
        {
          lossTolerance: parameters.slPercent.value,
          profitTargets: [
            {
              quantityPercentage: 0.6,  // Scale out 60% at first target
              deltaPercentage: parameters.tpLongPercent.value,
            },
            {
              quantityPercentage: 0.25,  // Scale out 25% at second target
              deltaPercentage: parameters.tpLongPercent.value * 1.5,
            },
            {
              quantityPercentage: 0.15,  // Scale out final 15% at third target
              deltaPercentage: parameters.tpLongPercent.value * 2,
            },
          ],
        }
      ),
    buyStrategy: (candles) =>
      ExponentialGrowthSniper.isBuySignal(
        candles[CandleChartInterval.FIFTEEN_MINUTES],
        {
          ...Object.entries(parameters).reduce(
            (prev, cur) => ({ [cur[0]]: cur[1].value, ...prev }),
            {}
          ),
        }
      ),
    sellStrategy: (candles) =>
      ExponentialGrowthSniper.isSellSignal(
        candles[CandleChartInterval.FIFTEEN_MINUTES],
        {
          ...Object.entries(parameters).reduce(
            (prev, cur) => ({ [cur[0]]: cur[1].value, ...prev }),
            {}
          ),
        }
      ),
    riskManagement: getPositionSizeByRisk,
  },
]; 