import { CandleChartInterval } from 'binance-api-node';
import { tickExitStrategy } from '../strategies/exit';
import { Complex } from '../strategies/entry';
import { getPositionSizeByRisk } from '../strategies/riskManagement';

export const hyperParameters = {
  // ADX - Trend Strength (from BTC-USDT optimal settings)
  adxType: { value: 'MASANAKAMURA' },
  adxLength: {
    value: 10, // Longer for BTC's volatility
    optimization: [10, 55],
    optimizationStep: 15  // Reduced range and added step
  },
  adxThreshold: {
    value: 12, // More sensitive to catch trends early
    optimization: [6, 18],
    optimizationStep: 6
  },

  // Support/Resistance - Reduced range for faster optimization
  supportResistanceLeftBars: {
    value: 6,  // Balanced for 15m timeframe
    optimization: [3, 9],
    optimizationStep: 3
  },
  supportResistanceRightBars: {
    value: 8,  // Slightly more forward-looking
    optimization: [5, 14],
    optimizationStep: 3
  },

  // Volume Analysis - More focused ranges for strong confirmation
  volumeMultiplier: {
    value: 1.5, // Strong volume confirmation
    optimization: [1.0, 2.0],
    optimizationStep: 0.5
  },
  volumeLength: {
    value: 25, // About 6 hours of data on 15m
    optimization: [20, 30],
    optimizationStep: 5
  },

  // PSAR for Trend Direction - Smaller ranges for critical parameters
  psarStep: {
    value: 0.2, // Balanced sensitivity
    //optimization: [0.15, 0.25],
    //optimizationStep: 0.01
  },
  psarMax: {
    value: 0.1, // Conservative max step
    //optimization: [0.08, 0.15],
    //optimizationStep: 0.01
  },

  // Range Filter for Volatility
  rangeFilterSourceType: { value: 'open' }, // More stable price reference
  rangeFilterPeriod: {
    value: 8, // Quick to react to changes
    //optimization: [6, 12],
    //optimizationStep: 1
  },
  rangeFilterMultiplier: {
    value: 1.4, // Strong trend confirmation
    //optimization: [1.2, 1.8],
    //optimizationStep: 0.1
  },

  // MACD for Momentum - Focused ranges based on common values
  macdFastLength: {
    value: 15, // Quick to react
    //optimization: [12, 18],
    //optimizationStep: 1
  },
  macdSlowLength: {
    value: 17, // Not too far from fast for quicker signals
    //optimization: [15, 21],
    //optimizationStep: 1
  },
  macdSourceType: { value: 'open' }, // More predictive
  macdSignalLength: {
    value: 20, // Smooth enough to avoid noise
    //optimization: [15, 25],
    //optimizationStep: 1
  },

  // RSI Settings - More focused optimization
  rsiLength: {
    value: 55, // Longer period for more reliable signals
    //optimization: [30, 70],
    //optimizationStep: 15
  },
  rsiSourceType: {
    value: 'low',
    //optimization: ['low', 'high'] 
  }, // Using low prices for better oversold signals

  // Momentum - Reduced ranges for precision
  momentumLength: {
    value: 10, // Fast momentum detection
    //optimization: [8, 15],
    //optimizationStep: 1
  },
  momentumTmoLength: {
    value: 3, // Very quick for TMO
    //optimization: [2, 5],
    //optimizationStep: 1
  },
  momentumSmoothLength: {
    value: 21, // Smooth enough to avoid noise
    //optimization: [15, 25],
    //optimizationStep: 2
  },

  // Moving Averages - Focused ranges for trend confirmation
  maLength: {
    value: 17, // Medium-term trend
    //optimization: [14, 20],
    //optimizationStep: 1
  },
  maSourceType: {
    value: 'open', //optimization: ['open', 'close'] 
  }, // More predictive
  jmaLength: {
    value: 14, // Shorter for JMA's better smoothing
    //optimization: [10, 18],
    //optimizationStep: 1
  },
  jmaSourceType: {
    value: 'low', //optimization: ['low', 'high'] 
  }, // Better support detection

  // Scalping Parameters - More focused ranges for quick trades
  emaScalpingLength: {
    value: 3, // Very fast reaction
    //optimization: [2, 5],
    //optimizationStep: 1
  },
  scalpingFastEmaLength: {
    value: 10, // Quick trend detection
    //optimization: [8, 15],
    //optimizationStep: 1
  },
  scalpingMediumEmaLength: {
    value: 120, // Intermediate trend
    //optimization: [100, 150],
    //optimizationStep: 10
  },
  scalpingSlowEmaLength: {
    value: 250, // Long-term trend
    //optimization: [200, 300],
    //optimizationStep: 25
  },
  scalpingLookBack: {
    value: 12, // About 3 hours of data
    //optimization: [10, 15],
    //optimizationStep: 1
  },
  scalpingUseHeikinAshiCandles: {
    value: true,
    //optimization: [true, false] 
  }, // Better trend visualization

  // RMI Settings - Focused ranges for momentum
  rmiLength: {
    value: 33, // Balanced sensitivity
    //optimization: [25, 40],
    //optimizationStep: 3
  },
  rmiSourceType: {
    value: 'close', //optimization: ['close', 'open'] 
  }, // Traditional momentum
  rmiMomentumLength: {
    value: 15, // Medium momentum window
    //optimization: [12, 18],
    //optimizationStep: 1
  },
  rmiOversold: {
    value: 44, // Conservative oversold
    //optimization: [35, 50],
    //optimizationStep: 3
  },
  rmiOverbought: {
    value: 62, // Conservative overbought
    //optimization: [55, 70],
    //optimizationStep: 3
  },

  // Bollinger Bands - Keep fixed as they're working well
  bollingerBandsLength: { value: 20 }, // Standard period
  bollingerBandsSourceType: { value: 'high' }, // Better resistance detection
  bollingerBandsMultiplier: { value: 2 }, // Standard deviation multiplier

  // Risk Management - Focused ranges for critical parameters
  tpLongPercent: {
    value: 0.02, // 2% first target
    optimization: [0.01, 0.04],
    optimizationStep: 0.01
  },
  tpShortPercent: {
    value: 0.02, // 2% first target
    optimization: [0.01, 0.04],
    optimizationStep: 0.01
  },
  slPercent: {
    value: 0.01, // 1% stop loss for better R:R
    optimization: [0.005, 0.02],
    optimizationStep: 0.005
  },
};

export const config: AbstractStrategyConfig = (parameters) => [
  {
    asset: 'BTC',  // Changed to BTC
    base: 'USDT',
    loopInterval: CandleChartInterval.FIFTEEN_MINUTES, // Balance between opportunities and noise
    indicatorIntervals: [CandleChartInterval.FIFTEEN_MINUTES],
    risk: 0.015, // 1.5% risk per trade - More conservative
    leverage: 3,
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
              quantityPercentage: 0.3, // Scale out 30% at first target
              deltaPercentage: parameters.tpLongPercent.value,
            },
            {
              quantityPercentage: 0.4, // Scale out 40% at second target
              deltaPercentage: parameters.tpLongPercent.value * 1.5,
            },
            {
              quantityPercentage: 0.3, // Let remaining 30% run for bigger moves
              deltaPercentage: parameters.tpLongPercent.value * 2.5,
            },
          ],
        }
      ),
    buyStrategy: (candles) =>
      Complex.BITCOIN_SNIPER_V1.isBuySignal(
        candles[CandleChartInterval.FIFTEEN_MINUTES],
        {
          ...Object.entries(parameters).reduce(
            (prev, cur) => ({ [cur[0]]: cur[1].value, ...prev }),
            {}
          ),
        }
      ),
    sellStrategy: (candles) =>
      Complex.BITCOIN_SNIPER_V1.isSellSignal(
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