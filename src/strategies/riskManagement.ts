import {
  getQuantityPrecision,
  getMinOrderQuantity,
} from '../utils/currencyInfo';
import { decimalCeil } from '../utils/math';

const MAX_POSITION_SIZE_PERCENT = 0.25; // Maximum 25% of balance for a single position

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
  
  // Cap the risk to maximum position size
  let adjustedRisk = Math.min(risk, MAX_POSITION_SIZE_PERCENT);
  
  // Calculate base position size (without leverage)
  let baseSize = (balance * adjustedRisk) / enterPrice;
  
  // Apply leverage to position size
  let quantity = baseSize * leverage;
  
  let minQuantity = getMinOrderQuantity(asset, base, enterPrice, exchangeInfo);

  // Ensure position size doesn't exceed maximum
  let maxQuantity = (balance * MAX_POSITION_SIZE_PERCENT * leverage) / enterPrice;
  quantity = Math.min(quantity, maxQuantity);

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
  
  // Cap the risk to maximum position size
  let adjustedRisk = Math.min(risk, MAX_POSITION_SIZE_PERCENT);
  
  // Calculate risk amount in base currency
  let riskAmount = balance * adjustedRisk;
  
  // Calculate position size based on stop loss distance
  let stopLossDistance = Math.abs(stopLossPrice - enterPrice) / enterPrice;
  
  // Calculate base position size (without leverage)
  let baseSize = riskAmount / (stopLossDistance * enterPrice);
  
  // Apply leverage to position size
  let quantity = baseSize * leverage;
  
  let minQuantity = getMinOrderQuantity(asset, base, enterPrice, exchangeInfo);
  
  // Ensure position size doesn't exceed maximum
  let maxQuantity = (balance * MAX_POSITION_SIZE_PERCENT * leverage) / enterPrice;
  quantity = Math.min(quantity, maxQuantity);

  return quantity > minQuantity
    ? decimalCeil(quantity, quantityPrecision)
    : decimalCeil(minQuantity, quantityPrecision);
}
