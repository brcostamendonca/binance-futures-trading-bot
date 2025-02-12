import { CandleChartInterval } from 'binance-api-node';
import { tickExitStrategy } from '../strategies/exit';
import { getPositionSizeByRisk } from '../strategies/riskManagement';
import * as ConservativeSniper from '../strategies/entry/complex/conservativeSniper';

export const hyperParameters = {
  // ADX - Trend Strength (Balanced but strong)
  adxType: { value: 'MASANAKAMURA' },
  adxLength: { value: 12 },           // Faster for better entries
  adxThreshold: { value: 18 },        // Moderate-high threshold

  // Support/Resistance (Precise levels)
  supportResistanceLeftBars: { value: 4 },
  supportResistanceRightBars: { value: 4 },

  // Volume Analysis (Quality trades)
  volumeMultiplier: { value: 1.2 },   // Moderate volume requirement
  volumeLength: { value: 14 },        // Shorter for responsiveness

  // PSAR Settings (More responsive)
  psarStep: { value: 0.018 },
  psarMax: { value: 0.18 },

  // Range Filter (More opportunities)
  rangeFilterSourceType: { value: 'close' },
  rangeFilterPeriod: { value: 10 },
  rangeFilterMultiplier: { value: 1.2 },

  // MACD Settings (Faster signals)
  macdFastLength: { value: 10 },
  macdSlowLength: { value: 21 },
  macdSourceType: { value: 'close' },
  macdSignalLength: { value: 8 },

  // RSI Settings (Better ranges)
  rsiLength: { value: 12 },
  rsiSourceType: { value: 'close' },

  // Momentum (Balanced)
  momentumLength: { value: 10 },
  momentumTmoLength: { value: 3 },
  momentumSmoothLength: { value: 10 },

  // Moving Averages (Responsive)
  maLength: { value: 14 },
  maSourceType: { value: 'close' },
  jmaLength: { value: 10 },
  jmaSourceType: { value: 'close' },

  // Scalping Parameters (Quality trades)
  emaScalpingLength: { value: 4 },
  scalpingFastEmaLength: { value: 15 },
  scalpingMediumEmaLength: { value: 40 },
  scalpingSlowEmaLength: { value: 150 },
  scalpingLookBack: { value: 10 },
  scalpingUseHeikinAshiCandles: { value: true },

  // RMI Settings (Better signals)
  rmiLength: { value: 10 },
  rmiSourceType: { value: 'close' },
  rmiMomentumLength: { value: 4 },
  rmiOversold: { value: 35 },        // More responsive
  rmiOverbought: { value: 65 },      // More responsive

  // Bollinger Bands (More opportunities)
  bollingerBandsLength: { value: 16 },
  bollingerBandsSourceType: { value: 'close' },
  bollingerBandsMultiplier: { value: 1.8 },

  // Risk Management (Safe exponential growth)
  tpLongPercent: { value: 0.015 },    // 1.5% first target
  tpShortPercent: { value: 0.015 },   // 1.5% first target
  slPercent: { value: 0.007 },        // 0.7% stop loss - ~1:2+ risk/reward
  maxPositionSize: { value: 0.13 },   // Max 13% of capital per trade
};

export const config: AbstractStrategyConfig = (parameters) => [
  {
    asset: 'BTC',
    base: 'USDT',
    loopInterval: CandleChartInterval.FIFTEEN_MINUTES,  // Faster for more opportunities
    indicatorIntervals: [CandleChartInterval.FIFTEEN_MINUTES],
    risk: 0.018,                      // 1.8% risk per trade
    leverage: 4,                      // 4x leverage for controlled growth
    allowPyramiding: true,           // Enable pyramiding for compound growth
    maxPyramidingAllocation: 0.25,   // Max 25% allocation with pyramiding
    unidirectional: true,            // Only take profit, no counter-trend trades
    canOpenNewPositionToCloseLast: false,  // Conservative position management
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
              quantityPercentage: 0.5,  // Scale out 50% at first target
              deltaPercentage: parameters.tpLongPercent.value,
            },
            {
              quantityPercentage: 0.3,  // Scale out 30% at second target
              deltaPercentage: parameters.tpLongPercent.value * 2,
            },
            {
              quantityPercentage: 0.2,  // Scale out final 20% at third target
              deltaPercentage: parameters.tpLongPercent.value * 3,
            },
          ],
        }
      ),
    buyStrategy: (candles) =>
      ConservativeSniper.isBuySignal(
        candles[CandleChartInterval.FIFTEEN_MINUTES],
        {
          ...Object.entries(parameters).reduce(
            (prev, cur) => ({ [cur[0]]: cur[1].value, ...prev }),
            {}
          ),
        }
      ),
    sellStrategy: (candles) =>
      ConservativeSniper.isSellSignal(
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