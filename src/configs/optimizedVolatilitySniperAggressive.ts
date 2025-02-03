import { CandleChartInterval } from 'binance-api-node';
import { tickExitStrategy } from '../strategies/exit';
import { Complex } from '../strategies/entry';
import { getPositionSizeByRisk } from '../strategies/riskManagement';

export const hyperParameters = {
  // ADX - Trend Strength (from BTC-USDT optimal settings)
  adxType: { value: 'MASANAKAMURA' },
  adxLength: { value: 33, optimization: [10, 50] }, // Longer for BTC's volatility
  adxThreshold: { value: 12, optimization: [5, 20] }, // More sensitive to catch trends early

  // Support/Resistance
  supportResistanceLeftBars: { value: 7, optimization: [5, 10] },
  supportResistanceRightBars: { value: 8, optimization: [5, 10] },

  // Volume Analysis
  volumeMultiplier: { value: 1.4, optimization: [1, 3] }, // Strong volume confirmation
  volumeLength: { value: 24, optimization: [10, 50] },

  // PSAR for Trend Direction
  psarStep: { value: 0.2, optimization: [0.1, 0.5] },
  psarMax: { value: 0.1, optimization: [0.05, 0.2] },

  // Range Filter for Volatility
  rangeFilterSourceType: { value: 'open' },
  rangeFilterPeriod: { value: 8, optimization: [5, 20] },
  rangeFilterMultiplier: { value: 1.4, optimization: [1, 3] },

  // MACD for Momentum
  macdFastLength: { value: 15, optimization: [5, 30] },
  macdSlowLength: { value: 17, optimization: [10, 30] },
  macdSourceType: { value: 'open' },
  macdSignalLength: { value: 20, optimization: [10, 30] },

  // RSI Settings
  rsiLength: { value: 55, optimization: [10, 100] }, // Longer period for more reliable signals
  rsiSourceType: { value: 'low', optimization: ['low', 'high'] }, // Using low prices for better oversold signals

  // Momentum
  momentumLength: { value: 10, optimization: [5, 30] },
  momentumTmoLength: { value: 3, optimization: [1, 10] },
  momentumSmoothLength: { value: 21, optimization: [10, 50] },

  // Moving Averages
  maLength: { value: 17, optimization: [5, 30] },
  maSourceType: { value: 'open', optimization: ['open', 'close'] },
  jmaLength: { value: 14, optimization: [5, 30] },
  jmaSourceType: { value: 'low', optimization: ['low', 'high'] },

  // Scalping Parameters
  emaScalpingLength: { value: 3, optimization: [1, 10] },
  scalpingFastEmaLength: { value: 10, optimization: [5, 30] },
  scalpingMediumEmaLength: { value: 120, optimization: [50, 200] },
  scalpingSlowEmaLength: { value: 250, optimization: [100, 500] },
  scalpingLookBack: { value: 12, optimization: [5, 30] },
  scalpingUseHeikinAshiCandles: { value: true, optimization: [true, false] },

  // RMI Settings
  rmiLength: { value: 33, optimization: [10, 50] },
  rmiSourceType: { value: 'close', optimization: ['close', 'open'] },
  rmiMomentumLength: { value: 15, optimization: [5, 30] },
  rmiOversold: { value: 44, optimization: [20, 80] },
  rmiOverbought: { value: 62, optimization: [40, 100] },

  // Bollinger Bands
  bollingerBandsLength: { value: 20 },
  bollingerBandsSourceType: { value: 'high' },
  bollingerBandsMultiplier: { value: 2 },

  // Risk Management - Optimized for BTC's volatility
  tpLongPercent: { value: 0.02, optimization: [0.01, 0.05] },  // 2% first target
  tpShortPercent: { value: 0.02, optimization: [0.01, 0.05] }, // 2% first target
  slPercent: { value: 0.01, optimization: [0.005, 0.02] },      // 1% stop loss for better R:R
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