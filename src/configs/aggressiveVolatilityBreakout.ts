import { CandleChartInterval } from 'binance-api-node';
import { tickExitStrategy } from '../strategies/exit';
import { getPositionSizeByRisk } from '../strategies/riskManagement';
import { BollingerBands, RSI, MACD } from 'technicalindicators';
import { decimalFloor } from '../utils/math';

export const hyperParameters = {
  // Bollinger Bands - More sensitive
  bollingerLength: { value: 12 },     // Even shorter for faster signals
  bollingerStdDev: { value: 2.0 },    // Standard deviation - more signals

  // RSI - Wider range
  rsiPeriod: { value: 14 },
  rsiOverbought: { value: 85 },       // Allow more room to run
  rsiOversold: { value: 15 },

  // MACD - Faster signals
  macdFast: { value: 6 },             // Super fast response
  macdSlow: { value: 18 },            // Shorter slow period
  macdSignal: { value: 4 },           // Quick signal line

  // Risk Management - Aggressive but protected
  stopLossPercent: { value: 0.02 },   // 2% stop loss
  takeProfitPercent: { value: 0.08 }, // 4:1 reward ratio
  minPositionSize: { value: 0.001 }
};

const isVolatilityBreakout = (candles: CandleData[], options: any) => {
  try {
    // Require more candles for proper calculation
    if (candles.length < Math.max(options.bollingerLength.value * 2, 50)) {
      // console.debug(`Not enough candles: ${candles.length}. Need at least ${Math.max(options.bollingerLength.value * 2, 50)}`);
      return { isLongEntry: false, isShortEntry: false };
    }

    // Extract close prices
    const closePrices = candles.map(c => c.close);
    // console.debug('Close prices length:', closePrices.length);
    // console.debug('First few close prices:', closePrices.slice(0, 5));

    // Calculate basic indicators with error checking
    let bb, rsi, macd;
    try {
      // Ensure we have valid inputs
      if (!options.bollingerLength?.value || !options.bollingerStdDev?.value) {
        throw new Error(`Invalid BB parameters: length=${options.bollingerLength?.value}, stdDev=${options.bollingerStdDev?.value}`);
      }

      bb = BollingerBands.calculate({
        period: Number(options.bollingerLength.value),
        values: closePrices,
        stdDev: Number(options.bollingerStdDev.value)
      });
      // console.debug('BB calculation successful. Results:', {
      //  length: bb.length,
      //  lastValue: bb[bb.length-1]
      // });
    } catch (error) {
      // console.error('BB calculation error:', error);
      // console.error('BB input:', {
      //   period: options.bollingerLength.value,
      //   valuesLength: closePrices.length,
      //   stdDev: options.bollingerStdDev.value
      // });
      return { isLongEntry: false, isShortEntry: false };
    }

    try {
      rsi = RSI.calculate({
        period: Number(options.rsiPeriod.value),
        values: closePrices
      });
    } catch (error) {
      // console.error('RSI calculation error:', error);
      return { isLongEntry: false, isShortEntry: false };
    }

    try {
      macd = MACD.calculate({
        values: closePrices,
        fastPeriod: Number(options.macdFast.value),
        slowPeriod: Number(options.macdSlow.value),
        signalPeriod: Number(options.macdSignal.value),
        SimpleMAOscillator: false,
        SimpleMASignal: false
      });
    } catch (error) {
      // console.error('MACD calculation error:', error);
      return { isLongEntry: false, isShortEntry: false };
    }

    // Validate indicator results
    if (!bb || !bb.length || !rsi || !rsi.length || !macd || !macd.length) {
      // console.error('Invalid indicator results:', { bb: !!bb, rsi: !!rsi, macd: !!macd });
      return { isLongEntry: false, isShortEntry: false };
    }

    // Get latest values
    const currentCandle = candles[candles.length-1];
    const prevCandle = candles[candles.length-2];
    const latestBB = bb[bb.length-1];
    const latestRSI = rsi[rsi.length-1];
    const latestMACD = macd[macd.length-1];

    // Validate latest values
    if (!latestBB || !latestRSI || !latestMACD || !latestMACD.MACD || !latestMACD.signal) {
      // console.error('Invalid latest values:', { 
      //   bb: !!latestBB, 
      //   rsi: !!latestRSI, 
      //   macd: !!latestMACD,
      //   macdValues: latestMACD
      //});
      return { isLongEntry: false, isShortEntry: false };
    }

    const macdHistogram = latestMACD.MACD - latestMACD.signal;

    // Add more debug logging
    // console.debug('Indicator Values:', {
    //  price: currentCandle.close,
    //  bb: {
    //    upper: latestBB.upper,
    //    lower: latestBB.lower,
    //    middle: latestBB.middle
    //  },
    //  rsi: latestRSI,
    //  macd: {
    //    macd: latestMACD.MACD,
    //    signal: latestMACD.signal,
    //    histogram: macdHistogram
    //  }
    //});

    // Calculate trend strength with more weight on recent candles
    const last8Candles = candles.slice(-8);
    const last5Candles = candles.slice(-5);
    const trendStrength = last8Candles.reduce((strength, candle, i) => {
      if (i === 0) return 0;
      const weight = Math.pow(1.2, i); // Exponential weight
      return strength + (candle.close - last8Candles[i-1].close) * weight;
    }, 0) / 8;

    // Calculate volume profile
    const last20Candles = candles.slice(-20);
    const avgVolume = last20Candles.reduce((sum, c) => sum + c.volume, 0) / 20;
    const currentVolume = currentCandle.volume;
    const volumeStrength = currentVolume / avgVolume;
    const volumeProfile = last5Candles.map(c => c.volume / avgVolume);
    const increasingVolume = volumeProfile.every((v, i) => 
      i === 0 || v >= volumeProfile[i-1] * 0.9
    );

    // Price action patterns
    const wickRatio = (currentCandle.high - currentCandle.low) !== 0 ? 
      Math.abs(currentCandle.close - currentCandle.open) / (currentCandle.high - currentCandle.low) : 0;
    const strongCandle = wickRatio > 0.6; // Strong body = strong momentum

    // Volatility expansion
    const currentRange = currentCandle.high - currentCandle.low;
    const prevRange = prevCandle.high - prevCandle.low;
    const expandingRange = currentRange > prevRange * 1.2;

    // More relaxed conditions
    const bbBreakUp = currentCandle.close > latestBB.upper * 1.001; // Just need to break band
    const bbBreakDown = currentCandle.close < latestBB.lower * 0.999;

    const strongMomentum = Math.abs(macdHistogram) > 50; // Reduced threshold
    const volumeConfirmation = currentVolume > avgVolume * 1.5; // Reduced volume requirement

    // Simpler trend following
    const isLongEntry = 
      (bbBreakUp || currentCandle.close > prevCandle.close * 1.01) && // BB break OR 1% up move
      trendStrength > 20 && // Reduced trend requirement
      latestRSI > 45 && latestRSI < 85 && // Wider RSI range
      (macdHistogram > 30 || // Either MACD momentum
       volumeStrength > 2) && // OR strong volume
      last5Candles[4].close > last5Candles[0].close; // Simple uptrend

    const isShortEntry =
      (bbBreakDown || currentCandle.close < prevCandle.close * 0.99) && // BB break OR 1% down move
      trendStrength < -20 && // Reduced trend requirement
      latestRSI < 55 && latestRSI > 15 && // Wider RSI range
      (macdHistogram < -30 || // Either MACD momentum
       volumeStrength > 2) && // OR strong volume
      last5Candles[4].close < last5Candles[0].close; // Simple downtrend

    // Log entry conditions
    if (isLongEntry || isShortEntry) {
      // console.debug(`
      //  SIGNAL DETECTED at ${currentCandle.openTime}:
      //  Type: ${isLongEntry ? 'LONG' : 'SHORT'}
      //  Price: ${currentCandle.close}
      //  Move Size: ${((currentCandle.close - prevCandle.close) / prevCandle.close * 100).toFixed(2)}%
      //  RSI: ${latestRSI}
      //  MACD: ${macdHistogram}
      //  Volume: ${volumeStrength.toFixed(2)}x
      //  Trend: ${trendStrength.toFixed(2)}
      // `);
    }

    return { isLongEntry, isShortEntry };
  } catch (error) {
    // console.error('Strategy Calculation Error:', error);
    return { isLongEntry: false, isShortEntry: false };
  }
};

export const config: AbstractStrategyConfig = (parameters) => [
  {
    asset: 'BTC',
    base: 'USDT',
    loopInterval: CandleChartInterval.FIFTEEN_MINUTES,
    indicatorIntervals: [CandleChartInterval.FIFTEEN_MINUTES],
    risk: 0.1,
    leverage: 10,
    allowPyramiding: false,
    unidirectional: false,
    canOpenNewPositionToCloseLast: true,

    exitStrategy: (price, candles, pricePrecision, side, exchangeInfo) => {
      try {
        const timeframeCandles = candles[CandleChartInterval.FIFTEEN_MINUTES];
        return tickExitStrategy(
          price,
          timeframeCandles,
          pricePrecision,
          side,
          exchangeInfo,
          {
            lossTolerance: parameters.stopLossPercent.value,
            profitTargets: [{ quantityPercentage: 1.0, deltaPercentage: parameters.takeProfitPercent.value }]
          }
        );
      } catch (error) {
        // console.error('Exit Strategy Error:', error);
        return null; // Return null instead of throwing
      }
    },

    riskManagement: (options) => {
      try {
        if (!options.stopLossPrice) {
          options.stopLossPrice = options.enterPrice * (1 - parameters.stopLossPercent.value);
        }
        return getPositionSizeByRisk(options);
      } catch (error) {
        // console.error('Risk Management Error:', error);
        return parameters.minPositionSize.value;
      }
    },

    // Simplified buy/sell strategies that ONLY return boolean
    buyStrategy: (candles) => {
      const timeframeCandles = candles[CandleChartInterval.FIFTEEN_MINUTES];
      return isVolatilityBreakout(timeframeCandles, parameters).isLongEntry;
    },

    sellStrategy: (candles) => {
      const timeframeCandles = candles[CandleChartInterval.FIFTEEN_MINUTES];
      return isVolatilityBreakout(timeframeCandles, parameters).isShortEntry;
    }
  }
]; 