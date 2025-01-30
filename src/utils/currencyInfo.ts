import { ExchangeInfo, FuturesOrderType_LT } from 'binance-api-node';
import { decimalCeil } from './math';

/**
 * @see https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#lot_size
 */
export function isValidQuantity(
  quantity: number,
  pair: string,
  exchangeInfo: ExchangeInfo<FuturesOrderType_LT>
) {
  const rules = getLotSizeQuantityRules(pair, exchangeInfo);
  return (
    Math.abs(quantity) >= rules.minQty && Math.abs(quantity) <= rules.maxQty
  );
}

/**
 * Get the minimal quantity to trade with this pair according to the
 * Binance futures trading rules
 */
export function getMinOrderQuantity(
  asset: string,
  base: string,
  basePrice: number,
  exchangeInfo: ExchangeInfo<FuturesOrderType_LT>
) {
  const precision = getQuantityPrecision(asset + base, exchangeInfo);
  const minimumNotionalValue = 5; // threshold in USDT
  return decimalCeil(minimumNotionalValue / basePrice, precision);
}

/**
 * Get the quantity rules to make a valid order
 * @see https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#lot_size
 * @see https://www.binance.com/en/support/faq/360033161972
 */
export function getLotSizeQuantityRules(
  pair: string,
  exchangeInfo: ExchangeInfo<FuturesOrderType_LT>
) {
  // @ts-ignore
  const { minQty, maxQty, stepSize } = exchangeInfo.symbols
    .find((symbol) => symbol.symbol === pair)
    // @ts-ignore
    .filters.find((filter) => filter.filterType === 'LOT_SIZE');

  return {
    minQty: Number(minQty),
    maxQty: Number(maxQty),
    stepSize: Number(stepSize),
  };
}

/**
 * Get the maximal number of decimals for a pair quantity
 */
export function getQuantityPrecision(
  pair: string,
  exchangeInfo: ExchangeInfo<FuturesOrderType_LT>
): number {
  const symbol = exchangeInfo.symbols.find((symbol) => symbol.symbol === pair);
  // @ts-ignore
  return symbol.quantityPrecision as number;
}

/**
 * Get the maximal number of decimals for a pair quantity
 */
export function getPricePrecision(
  pair: string,
  exchangeInfo: ExchangeInfo<FuturesOrderType_LT>
): number {
  const tickSize = getTickSize(pair, exchangeInfo);
  if (tickSize.toString().split('.').length > 0) {
    return tickSize.toString().split('.')[1].length;
  } else {
    return 0;
  }
}

/**
 * Get the tick size for a symbol
 */
export function getTickSize(
  pair: string, 
  exchangeInfo: ExchangeInfo<FuturesOrderType_LT>
) {
  const symbol = exchangeInfo.symbols.find((symbol) => symbol.symbol === pair);
  const filter = symbol.filters.find((f) => f.filterType === 'PRICE_FILTER');
  // @ts-ignore
  return Number(filter.tickSize);
}
