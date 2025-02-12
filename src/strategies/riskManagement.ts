import {
  getQuantityPrecision,
  getMinOrderQuantity,
} from '../utils/currencyInfo';
import { decimalCeil } from '../utils/math';

/**
 * Calculate the quantity of crypto to buy according to your available balance,
 * the allocation you want, and the current price of the crypto
 */
export function getPositionSizeByPercent({
  asset,
  base,
  balance,
  risk,
  enterPrice,
  exchangeInfo,
  leverage = 1,
}: RiskManagementOptions) {
  let pair = asset + base;
  let quantityPrecision = getQuantityPrecision(pair, exchangeInfo);
  let quantity = (balance * risk * leverage) / enterPrice;
  let minQuantity = getMinOrderQuantity(asset, base, enterPrice, exchangeInfo);

  return quantity > minQuantity
    ? decimalCeil(quantity, quantityPrecision)
    : decimalCeil(minQuantity, quantityPrecision);
}

/**
 * Calculate the quantity of crypto to buy according to the risk
 */
export function getPositionSizeByRisk({
  asset,
  base,
  balance,
  risk,
  enterPrice,
  stopLossPrice,
  exchangeInfo,
  leverage = 1,
}: RiskManagementOptions) {
  if (!stopLossPrice) {
    return getPositionSizeByPercent({
      asset,
      base,
      balance,
      risk,
      enterPrice,
      exchangeInfo,
      leverage,
    });
  }
  let pair = asset + base;
  let quantityPrecision = getQuantityPrecision(pair, exchangeInfo);
  let riskBalance = balance * risk;
  let delta = Math.abs(stopLossPrice - enterPrice) / enterPrice;
  let quantity = (riskBalance / delta / enterPrice) * leverage;
  let minQuantity = getMinOrderQuantity(asset, base, enterPrice, exchangeInfo);

  return quantity > minQuantity
    ? decimalCeil(quantity, quantityPrecision)
    : decimalCeil(minQuantity, quantityPrecision);
}
