import { PSAR, SMA as LibSMA } from 'technicalindicators';
import {
  AdxMasanaKamura,
  RSI,
  RangeBands,
  SMA,
  JMA,
  MACD,
  RMI,
  SmoothMomentum,
  SupportResistance,
  BollingerBands,
  VWMA,
  EMA,
  ADX,
} from '../../../indicators';
import { debug } from '../../../utils/log';

interface Options {
  adxType?: 'CLASSIC' | 'MASANAKAMURA';
  adxLength?: number;
  adxThreshold?: number;
  supportResistanceLeftBars?: number;
  supportResistanceRightBars?: number;
  volumeMultiplier?: number;
  volumeLength?: number;
  psarStep?: number;
  psarMax?: number;
  rangeFilterSourceType?: SourceType;
  rangeFilterPeriod?: number;
  rangeFilterMultiplier?: number;
  macdFastLength?: number;
  macdSlowLength?: number;
  macdSignalLength?: number;
  macdSourceType?: SourceType;
  rsiLength?: number;
  rsiSourceType?: SourceType;
  momentumLength?: number;
  momentumTmoLength?: number;
  momentumSmoothLength?: number;
  maLength?: number;
  maSourceType?: SourceType;
  jmaLength?: number;
  jmaSourceType?: SourceType;
  rmiLength?: number;
  rmiSourceType?: SourceType;
  rmiMomentumLength?: number;
  rmiOversold?: number;
  rmiOverbought?: number;
  bollingerBandsLength?: number;
  bollingerBandsSourceType?: SourceType;
  bollingerBandsMultiplier?: number;
}

const defaultOptions: Options = {
  adxType: 'MASANAKAMURA',
  adxLength: 14,
  adxThreshold: 20,
  supportResistanceLeftBars: 4,
  supportResistanceRightBars: 4,
  volumeMultiplier: 1.2,
  volumeLength: 14,
  psarStep: 0.018,
  psarMax: 0.18,
  rangeFilterSourceType: 'close',
  rangeFilterPeriod: 10,
  rangeFilterMultiplier: 1.2,
  macdFastLength: 10,
  macdSlowLength: 21,
  macdSignalLength: 8,
  macdSourceType: 'close',
  rsiLength: 12,
  rsiSourceType: 'close',
  momentumLength: 10,
  momentumTmoLength: 3,
  momentumSmoothLength: 10,
  maLength: 14,
  maSourceType: 'close',
  jmaLength: 10,
  jmaSourceType: 'close',
  rmiLength: 10,
  rmiSourceType: 'close',
  rmiMomentumLength: 4,
  rmiOversold: 35,
  rmiOverbought: 65,
  bollingerBandsLength: 16,
  bollingerBandsSourceType: 'close',
  bollingerBandsMultiplier: 1.8,
};

// Add adxCondition function before other indicator functions
const adxCondition = (candles: CandleData[], options: Options) => {
  const { adxType = defaultOptions.adxType,
          adxLength = defaultOptions.adxLength,
          adxThreshold = defaultOptions.adxThreshold } = options;
  
  if (adxType === 'CLASSIC') {
    let { minus, plus, adx } = ADX.calculate(candles, {
      period: adxLength,
    }).slice(-1)[0];

    let adxLongCond = plus > minus && adx > adxThreshold;
    let adxShortCond = plus < minus && adx > adxThreshold;
    return { adxLongCond, adxShortCond };
  }
  
  let { DIM, DIP, adx } = AdxMasanaKamura.calculate(candles, {
    atrLength: adxLength,
  }).slice(-1)[0];

  let adxLongCond = DIP > DIM && adx > adxThreshold;
  let adxShortCond = DIP < DIM && adx > adxThreshold;
  return { adxLongCond, adxShortCond };
};

// Helper functions for technical indicators
const psarCondition = (candles: CandleData[], options: Options) => {
  const { psarStep = defaultOptions.psarStep, psarMax = defaultOptions.psarMax } = options;
  
  let psar = PSAR.calculate({
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    max: psarMax,
    step: psarStep,
  }).slice(-1)[0];

  let psarLongCond = psar < candles[candles.length - 1].close;
  let psarShortCond = psar > candles[candles.length - 1].close;
  return { psarLongCond, psarShortCond };
};

const supportResistanceCondition = (candles: CandleData[], options: Options) => {
  const { supportResistanceLeftBars = defaultOptions.supportResistanceLeftBars, 
          supportResistanceRightBars = defaultOptions.supportResistanceRightBars } = options;
  
  let sr = SupportResistance.calculate(candles, {
    leftBars: supportResistanceLeftBars,
    rightBars: supportResistanceRightBars,
  }).slice(-2);

  let curClose = candles[candles.length - 1].close;
  let prevClose = candles[candles.length - 2].close;
  let srLongCond = curClose > sr[1].top;
  let srShortCond = curClose < sr[1].bottom;
  return { srLongCond, srShortCond };
};

const volumeCondition = (candles: CandleData[], options: Options) => {
  const { volumeLength = defaultOptions.volumeLength, 
          volumeMultiplier = defaultOptions.volumeMultiplier } = options;
  
  let ma = SMA.calculate(candles, {
    sourceType: 'volume',
    period: volumeLength,
  }).map((v) => v * volumeMultiplier);

  return candles[candles.length - 1].volume > ma[ma.length - 1];
};

const rangeFilterCondition = (candles: CandleData[], options: Options) => {
  const { rangeFilterSourceType = defaultOptions.rangeFilterSourceType,
          rangeFilterPeriod = defaultOptions.rangeFilterPeriod,
          rangeFilterMultiplier = defaultOptions.rangeFilterMultiplier } = options;
  
  let { highBand, lowBand, upward, downward } = RangeBands.calculate(candles, {
    multiplier: rangeFilterMultiplier,
    sourceType: rangeFilterSourceType,
    period: rangeFilterPeriod,
  }).slice(-1)[0];

  let rangeFilterLongCond = candles[candles.length - 1].high > highBand && upward > 0;
  let rangeFilterShortCond = candles[candles.length - 1].low < lowBand && downward > 0;
  return { rangeFilterLongCond, rangeFilterShortCond };
};

const macdCondition = (candles: CandleData[], options: Options) => {
  const { macdFastLength = defaultOptions.macdFastLength,
          macdSlowLength = defaultOptions.macdSlowLength,
          macdSignalLength = defaultOptions.macdSignalLength,
          macdSourceType = defaultOptions.macdSourceType } = options;
  
  let { macd, signal } = MACD.calculate(candles, {
    fastLength: macdFastLength,
    slowLength: macdSlowLength,
    signalLength: macdSignalLength,
    sourceType: macdSourceType,
    signalMaType: 'SMA',
  }).slice(-1)[0];

  return { macdLongCond: macd > signal, macdShortCond: macd < signal };
};

const rsiCondition = (candles: CandleData[], options: Options) => {
  const { rsiLength = defaultOptions.rsiLength,
          rsiSourceType = defaultOptions.rsiSourceType } = options;
  
  let value = RSI.calculate(candles, { period: rsiLength, sourceType: rsiSourceType }).slice(-1)[0];
  return { rsiLongCond: value < 70, rsiShortCond: value > 30 };
};

const momentumCondition = (candles: CandleData[], options: Options) => {
  const { momentumLength = defaultOptions.momentumLength,
          momentumTmoLength = defaultOptions.momentumTmoLength,
          momentumSmoothLength = defaultOptions.momentumSmoothLength } = options;
  
  let { main, signal } = SmoothMomentum.calculate(candles, {
    tmoLength: momentumTmoLength,
    smoothLength: momentumSmoothLength,
    length: momentumLength,
  }).slice(-1)[0];

  return { momentumLongCond: main > signal, momentumShortCond: main < signal };
};

const maCondition = (candles: CandleData[], options: Options) => {
  const { maLength = defaultOptions.maLength,
          maSourceType = defaultOptions.maSourceType } = options;
  
  let vwma = VWMA.calculate(candles, { period: maLength, sourceType: maSourceType }).slice(-2);
  let maSpeed = (vwma[1] / vwma[0] - 1) * 100;
  return { maLongCond: maSpeed > 0, maShortCond: maSpeed < 0 };
};

const jmaCondition = (candles: CandleData[], options: Options) => {
  const { jmaLength = defaultOptions.jmaLength,
          jmaSourceType = defaultOptions.jmaSourceType } = options;
  
  let jma = JMA.calculate(candles, { period: jmaLength, sourceType: jmaSourceType }).slice(-1)[0];
  let low = candles[candles.length - 2].low;
  let signal = low > jma ? 1 : low < jma ? -1 : 0;
  return { jmaLongCond: signal > 0, jmaShortCond: signal < 0 };
};

const bollingerBandsCondition = (candles: CandleData[], options: Options) => {
  const { bollingerBandsLength = defaultOptions.bollingerBandsLength,
          bollingerBandsSourceType = defaultOptions.bollingerBandsSourceType,
          bollingerBandsMultiplier = defaultOptions.bollingerBandsMultiplier } = options;
  
  let bb = BollingerBands.calculate(candles, {
    period: bollingerBandsLength,
    sourceType: bollingerBandsSourceType,
    multiplier: bollingerBandsMultiplier,
  });

  let prevBB = bb[bb.length - 2];
  let curBB = bb[bb.length - 1];
  let fastMax = EMA.calculate(candles, { period: 6, sourceType: bollingerBandsSourceType });

  let avgSpread = LibSMA.calculate({
    period: 120,
    values: bb.map((v) => v.spread),
  }).slice(-1)[0];

  let bbSqueeze = (curBB.spread / avgSpread) * 100;
  let bbLongCond = fastMax[fastMax.length - 2] < prevBB.basis &&
                   fastMax[fastMax.length - 1] > curBB.basis &&
                   candles[candles.length - 1].close > curBB.basis &&
                   bbSqueeze > 50;

  let bbShortCond = fastMax[fastMax.length - 2] > prevBB.basis &&
                    fastMax[fastMax.length - 1] < curBB.basis &&
                    candles[candles.length - 1].close < curBB.basis &&
                    bbSqueeze > 50;

  return { bbLongCond, bbShortCond };
};

const rmiCondition = (candles: CandleData[], options: Options) => {
  const { rmiLength = defaultOptions.rmiLength,
          rmiSourceType = defaultOptions.rmiSourceType,
          rmiMomentumLength = defaultOptions.rmiMomentumLength,
          rmiOversold = defaultOptions.rmiOversold,
          rmiOverbought = defaultOptions.rmiOverbought } = options;
  
  let rmi = RMI.calculate(candles, {
    length: rmiLength,
    momentum: rmiMomentumLength,
    sourceType: rmiSourceType,
  }).slice(-2);

  let rmiLongCond = rmi[0] < rmiOversold && rmi[1] > rmiOversold;
  let rmiShortCond = rmi[0] > rmiOverbought && rmi[1] < rmiOverbought;
  return { rmiLongCond, rmiShortCond };
};

export const isBuySignal = (candles: CandleData[], options?: Options) => {
  debug('=================== EXPONENTIAL GROWTH BUY SIGNAL CHECK ===================');
  debug(`Checking buy signal with ${candles.length} candles`);
  debug(`Latest candle - Time: ${new Date(candles[candles.length - 1].closeTime).toISOString()}`);
  debug(`Latest candle - OHLCV: ${JSON.stringify({
    open: candles[candles.length - 1].open,
    high: candles[candles.length - 1].high,
    low: candles[candles.length - 1].low,
    close: candles[candles.length - 1].close,
    volume: candles[candles.length - 1].volume
  })}`);
  
  options = { ...defaultOptions, ...options };
  debug(`Using options: ${JSON.stringify(options, null, 2)}`);

  // Get all indicator conditions
  const { adxLongCond } = adxCondition(candles, options);
  const { psarLongCond } = psarCondition(candles, options);
  const { srLongCond } = supportResistanceCondition(candles, options);
  const volCond = volumeCondition(candles, options);
  const { rangeFilterLongCond } = rangeFilterCondition(candles, options);
  const { macdLongCond } = macdCondition(candles, options);
  const { rsiLongCond } = rsiCondition(candles, options);
  const { momentumLongCond } = momentumCondition(candles, options);
  const { maLongCond } = maCondition(candles, options);
  const { jmaLongCond } = jmaCondition(candles, options);
  const { bbLongCond } = bollingerBandsCondition(candles, options);
  const { rmiLongCond } = rmiCondition(candles, options);

  // Log all conditions
  debug('Primary Indicators:');
  debug(`- ADX long condition: ${adxLongCond}`);
  debug(`- PSAR long condition: ${psarLongCond}`);
  debug(`- S/R long condition: ${srLongCond}`);

  debug('Momentum Indicators:');
  debug(`- MACD long condition: ${macdLongCond}`);
  debug(`- Momentum long condition: ${momentumLongCond}`);
  debug(`- RSI long condition: ${rsiLongCond}`);

  debug('Volume and Range:');
  debug(`- Volume condition: ${volCond}`);
  debug(`- Range filter long condition: ${rangeFilterLongCond}`);

  debug('Moving Averages:');
  debug(`- MA long condition: ${maLongCond}`);
  debug(`- JMA long condition: ${jmaLongCond}`);

  debug('Additional Indicators:');
  debug(`- BB long condition: ${bbLongCond}`);
  debug(`- RMI long condition: ${rmiLongCond}`);

  // Primary entry conditions (need 1 out of 3)
  const primaryConfirmations = [
    adxLongCond,
    psarLongCond,
    srLongCond
  ].filter(Boolean).length >= 1;
  debug(`Primary confirmations (need 1/3): ${primaryConfirmations}`);

  // Momentum conditions (need 1 out of 3)
  const momentumConfirmations = [
    macdLongCond,
    momentumLongCond,
    rsiLongCond
  ].filter(Boolean).length >= 1;
  debug(`Momentum confirmations (need 1/3): ${momentumConfirmations}`);

  // Volume and range conditions (need one)
  const volumeAndRange = volCond || rangeFilterLongCond;
  debug(`Volume and range confirmation (need one): ${volumeAndRange}`);

  // Moving average conditions (need 1 out of 2)
  const maConfirmations = [
    maLongCond,
    jmaLongCond
  ].filter(Boolean).length >= 1;
  debug(`Moving average confirmations (need 1/2): ${maConfirmations}`);

  // Additional confirmations (need 1 out of 2)
  const additionalConfirmations = [
    bbLongCond,
    rmiLongCond
  ].filter(Boolean).length >= 1;
  debug(`Additional confirmations (need 1/2): ${additionalConfirmations}`);

  // Need only 1 out of 4 major confirmations (more lenient)
  const buySignal = [
    primaryConfirmations,
    momentumConfirmations,
    volumeAndRange,
    maConfirmations || additionalConfirmations
  ].filter(Boolean).length >= 1;

  debug('=================== SIGNAL SUMMARY ===================');
  debug(`Primary confirmations met: ${primaryConfirmations}`);
  debug(`- ADX long: ${adxLongCond}`);
  debug(`- PSAR long: ${psarLongCond}`);
  debug(`- S/R long: ${srLongCond}`);
  
  debug(`Momentum confirmations met: ${momentumConfirmations}`);
  debug(`- MACD long: ${macdLongCond}`);
  debug(`- Momentum long: ${momentumLongCond}`);
  debug(`- RSI long: ${rsiLongCond}`);
  
  debug(`Volume and Range met: ${volumeAndRange}`);
  debug(`- Volume condition: ${volCond}`);
  debug(`- Range filter long: ${rangeFilterLongCond}`);
  
  debug(`MA/Additional confirmations met: ${maConfirmations || additionalConfirmations}`);
  debug(`- MA long: ${maLongCond}`);
  debug(`- JMA long: ${jmaLongCond}`);
  debug(`- BB long: ${bbLongCond}`);
  debug(`- RMI long: ${rmiLongCond}`);
  
  debug(`Final buy signal: ${buySignal}`);
  debug('================================================');

  debug('================================================================');
  return buySignal;
};

export const isSellSignal = (candles: CandleData[], options?: Options) => {
  debug('=================== EXPONENTIAL GROWTH SELL SIGNAL CHECK ===================');
  debug(`Checking sell signal with ${candles.length} candles`);
  debug(`Latest candle - Time: ${new Date(candles[candles.length - 1].closeTime).toISOString()}`);
  debug(`Latest candle - OHLCV: ${JSON.stringify({
    open: candles[candles.length - 1].open,
    high: candles[candles.length - 1].high,
    low: candles[candles.length - 1].low,
    close: candles[candles.length - 1].close,
    volume: candles[candles.length - 1].volume
  })}`);
  
  options = { ...defaultOptions, ...options };
  debug(`Using options: ${JSON.stringify(options, null, 2)}`);

  // Get all indicator conditions
  const { adxShortCond } = adxCondition(candles, options);
  const { psarShortCond } = psarCondition(candles, options);
  const { srShortCond } = supportResistanceCondition(candles, options);
  const volCond = volumeCondition(candles, options);
  const { rangeFilterShortCond } = rangeFilterCondition(candles, options);
  const { macdShortCond } = macdCondition(candles, options);
  const { rsiShortCond } = rsiCondition(candles, options);
  const { momentumShortCond } = momentumCondition(candles, options);
  const { maShortCond } = maCondition(candles, options);
  const { jmaShortCond } = jmaCondition(candles, options);
  const { bbShortCond } = bollingerBandsCondition(candles, options);
  const { rmiShortCond } = rmiCondition(candles, options);

  // Log all conditions
  debug('Primary Indicators:');
  debug(`- ADX short condition: ${adxShortCond}`);
  debug(`- PSAR short condition: ${psarShortCond}`);
  debug(`- S/R short condition: ${srShortCond}`);

  debug('Momentum Indicators:');
  debug(`- MACD short condition: ${macdShortCond}`);
  debug(`- Momentum short condition: ${momentumShortCond}`);
  debug(`- RSI short condition: ${rsiShortCond}`);

  debug('Volume and Range:');
  debug(`- Volume condition: ${volCond}`);
  debug(`- Range filter short condition: ${rangeFilterShortCond}`);

  debug('Moving Averages:');
  debug(`- MA short condition: ${maShortCond}`);
  debug(`- JMA short condition: ${jmaShortCond}`);

  debug('Additional Indicators:');
  debug(`- BB short condition: ${bbShortCond}`);
  debug(`- RMI short condition: ${rmiShortCond}`);

  // Primary entry conditions (need 1 out of 3)
  const primaryConfirmations = [
    adxShortCond,
    psarShortCond,
    srShortCond
  ].filter(Boolean).length >= 1;
  debug(`Primary confirmations (need 1/3): ${primaryConfirmations}`);

  // Momentum conditions (need 1 out of 3)
  const momentumConfirmations = [
    macdShortCond,
    momentumShortCond,
    rsiShortCond
  ].filter(Boolean).length >= 1;
  debug(`Momentum confirmations (need 1/3): ${momentumConfirmations}`);

  // Volume and range conditions (need one)
  const volumeAndRange = volCond || rangeFilterShortCond;
  debug(`Volume and range confirmation (need one): ${volumeAndRange}`);

  // Moving average conditions (need 1 out of 2)
  const maConfirmations = [
    maShortCond,
    jmaShortCond
  ].filter(Boolean).length >= 1;
  debug(`Moving average confirmations (need 1/2): ${maConfirmations}`);

  // Additional confirmations (need 1 out of 2)
  const additionalConfirmations = [
    bbShortCond,
    rmiShortCond
  ].filter(Boolean).length >= 1;
  debug(`Additional confirmations (need 1/2): ${additionalConfirmations}`);

  // Need only 1 out of 4 major confirmations (more lenient)
  const sellSignal = [
    primaryConfirmations,
    momentumConfirmations,
    volumeAndRange,
    maConfirmations || additionalConfirmations
  ].filter(Boolean).length >= 1;

  debug(`Final exponential growth sell signal: ${sellSignal}`);
  debug('================================================================');
  return sellSignal;
}; 