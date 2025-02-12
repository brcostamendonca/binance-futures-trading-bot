import * as RSI from './basics/rsi';
import * as MA from './basics/ma';
import * as MACD from './basics/macd';
import * as MA_CROSS from './basics/maCross';
import * as RELOAD_ZONE from './basics/reloadZone';
import * as STOCHASTIC_RSI from './basics/stochasticRsi';

export const Basics = {
  RSI,
  MA,
  MACD,
  MA_CROSS,
  RELOAD_ZONE,
  STOCHASTIC_RSI,
};

import * as BITCOIN_SNIPER_V1 from './complex/bitcoinSniperV1';
import * as CONSERVATIVE_SNIPER from './complex/conservativeSniper';
import * as EXPONENTIAL_GROWTH_SNIPER from './complex/exponentialGrowthSniper';

export const Complex = {
  BITCOIN_SNIPER_V1,
  CONSERVATIVE_SNIPER,
  EXPONENTIAL_GROWTH_SNIPER,
};
