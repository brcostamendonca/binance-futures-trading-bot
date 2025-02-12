import { PSAR, SMA as LibSMA } from 'technicalindicators';
import {
  AdxMasanaKamura,
  RSI,
  RangeBands,
  SMA,
  HMA,
  JMA,
  MACD,
  RMI,
  Scalping,
  SmoothAO,
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
  emaScalpingLength?: number;
  scalpingFastEmaLength?: number;
  scalpingMediumEmaLength?: number;
  scalpingSlowEmaLength?: number;
  scalpingLookBack?: number;
  scalpingUseHeikinAshiCandles?: true;
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
  adxThreshold: 25,
  supportResistanceLeftBars: 5,
  supportResistanceRightBars: 5,
  volumeMultiplier: 1.2,
  volumeLength: 20,
  psarStep: 0.02,
  psarMax: 0.2,
  rangeFilterSourceType: 'close',
  rangeFilterPeriod: 14,
  rangeFilterMultiplier: 1.5,
  macdFastLength: 12,
  macdSlowLength: 26,
  macdSignalLength: 9,
  macdSourceType: 'close',
  rsiLength: 14,
  rsiSourceType: 'close',
  momentumLength: 14,
  momentumTmoLength: 5,
  momentumSmoothLength: 14,
  maLength: 20,
  maSourceType: 'close',
  jmaLength: 14,
  jmaSourceType: 'close',
  emaScalpingLength: 5,
  scalpingFastEmaLength: 20,
  scalpingMediumEmaLength: 50,
  scalpingSlowEmaLength: 200,
  scalpingLookBack: 14,
  scalpingUseHeikinAshiCandles: true,
  rmiLength: 14,
  rmiSourceType: 'close',
  rmiMomentumLength: 5,
  rmiOversold: 30,
  rmiOverbought: 70,
  bollingerBandsLength: 20,
  bollingerBandsSourceType: 'close',
  bollingerBandsMultiplier: 2,
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
  let ao = SmoothAO.calculate(candles, { fastLength: 6, slowLength: 16, sourceType: 'hl2' }).slice(-1)[0];

  let avgSpread = LibSMA.calculate({
    period: 120,
    values: bb.map((v) => v.spread),
  }).slice(-1)[0];

  let bbSqueeze = (curBB.spread / avgSpread) * 100;
  let bbLongCond = fastMax[fastMax.length - 2] < prevBB.basis &&
                   fastMax[fastMax.length - 1] > curBB.basis &&
                   candles[candles.length - 1].close > curBB.basis &&
                   Math.abs(ao) === 1 &&
                   bbSqueeze > 50;

  let bbShortCond = fastMax[fastMax.length - 2] > prevBB.basis &&
                    fastMax[fastMax.length - 1] < curBB.basis &&
                    candles[candles.length - 1].close < curBB.basis &&
                    Math.abs(ao) === 2 &&
                    bbSqueeze > 50;

  return { bbLongCond, bbShortCond };
};

// Helper functions for technical indicators remain the same as bitcoinSniperV1
const adxCondition = (candles: CandleData[], options: Options) => {
  const { adxType = defaultOptions.adxType, adxLength = defaultOptions.adxLength, adxThreshold = defaultOptions.adxThreshold } = options;
  
  if (adxType === 'CLASSIC') {
    let { minus, plus, adx } = ADX.calculate(candles, { period: adxLength }).slice(-1)[0];
    let adxLongCond = plus > minus && adx > adxThreshold;
    let adxShortCond = plus < minus && adx > adxThreshold;
    return { adxLongCond, adxShortCond };
  }
  
  let { DIM, DIP, adx } = AdxMasanaKamura.calculate(candles, { atrLength: adxLength }).slice(-1)[0];
  let adxLongCond = DIP > DIM && adx > adxThreshold;
  let adxShortCond = DIP < DIM && adx > adxThreshold;
  return { adxLongCond, adxShortCond };
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

// Other indicator calculation functions remain the same...

export const isBuySignal = (candles: CandleData[], options?: Options) => {
  debug('Checking conservative buy signal conditions:');
  options = { ...defaultOptions, ...options };

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
  debug(`- ADX long condition: ${adxLongCond}`);
  debug(`- PSAR long condition: ${psarLongCond}`);
  debug(`- S/R long condition: ${srLongCond}`);
  debug(`- Volume condition: ${volCond}`);
  debug(`- Range filter long condition: ${rangeFilterLongCond}`);
  debug(`- MACD long condition: ${macdLongCond}`);
  debug(`- RSI long condition: ${rsiLongCond}`);
  debug(`- Momentum long condition: ${momentumLongCond}`);
  debug(`- MA long condition: ${maLongCond}`);
  debug(`- JMA long condition: ${jmaLongCond}`);
  debug(`- BB long condition: ${bbLongCond}`);
  debug(`- RMI long condition: ${rmiLongCond}`);

  // Conservative entry conditions requiring strong trend confirmation
  const trendConfirmation = adxLongCond && psarLongCond && rangeFilterLongCond;
  const momentumConfirmation = macdLongCond && momentumLongCond && rsiLongCond;
  const volumeConfirmation = volCond && srLongCond;
  const maConfirmation = maLongCond && jmaLongCond;

  // Primary entry condition requiring ALL confirmations
  const primaryEntry = trendConfirmation && momentumConfirmation && volumeConfirmation && maConfirmation;

  // Secondary entry condition using Bollinger Bands breakout with strong momentum
  const secondaryEntry = bbLongCond && trendConfirmation && momentumConfirmation && volumeConfirmation;

  // Tertiary entry condition using RMI with trend confirmation
  const tertiaryEntry = rmiLongCond && trendConfirmation && volumeConfirmation && maConfirmation;

  const buySignal = primaryEntry || secondaryEntry || tertiaryEntry;
  debug(`Final conservative buy signal: ${buySignal}`);
  return buySignal;
};

export const isSellSignal = (candles: CandleData[], options?: Options) => {
  debug('Checking conservative sell signal conditions:');
  options = { ...defaultOptions, ...options };

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
  debug(`- ADX short condition: ${adxShortCond}`);
  debug(`- PSAR short condition: ${psarShortCond}`);
  debug(`- S/R short condition: ${srShortCond}`);
  debug(`- Volume condition: ${volCond}`);
  debug(`- Range filter short condition: ${rangeFilterShortCond}`);
  debug(`- MACD short condition: ${macdShortCond}`);
  debug(`- RSI short condition: ${rsiShortCond}`);
  debug(`- Momentum short condition: ${momentumShortCond}`);
  debug(`- MA short condition: ${maShortCond}`);
  debug(`- JMA short condition: ${jmaShortCond}`);
  debug(`- BB short condition: ${bbShortCond}`);
  debug(`- RMI short condition: ${rmiShortCond}`);

  // Conservative entry conditions requiring strong trend confirmation
  const trendConfirmation = adxShortCond && psarShortCond && rangeFilterShortCond;
  const momentumConfirmation = macdShortCond && momentumShortCond && rsiShortCond;
  const volumeConfirmation = volCond && srShortCond;
  const maConfirmation = maShortCond && jmaShortCond;

  // Primary entry condition requiring ALL confirmations
  const primaryEntry = trendConfirmation && momentumConfirmation && volumeConfirmation && maConfirmation;

  // Secondary entry condition using Bollinger Bands breakout with strong momentum
  const secondaryEntry = bbShortCond && trendConfirmation && momentumConfirmation && volumeConfirmation;

  // Tertiary entry condition using RMI with trend confirmation
  const tertiaryEntry = rmiShortCond && trendConfirmation && volumeConfirmation && maConfirmation;

  const sellSignal = primaryEntry || secondaryEntry || tertiaryEntry;
  debug(`Final conservative sell signal: ${sellSignal}`);
  return sellSignal;
}; 