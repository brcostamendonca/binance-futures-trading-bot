import {
  CandleChartInterval,
  ExchangeInfo,
  FuturesAccountInfoResult,
  OrderSide,
  OrderType,
  FuturesOrderType_LT,
  TimeInForce,
  FuturesOrder
} from 'binance-api-node';
import { decimalFloor } from './utils/math';
import { log, error as logError, logBuySellExecutionOrder, debug } from './utils/log';
import { binanceClient } from './init';
import { loadCandlesMultiTimeFramesFromAPI } from './utils/loadCandleData';
import { Counter } from './tools/counter';
import { isOnTradingSession } from './utils/tradingSession';
import { sendTelegramMessage } from './telegram';
import dayjs from 'dayjs';
import { getPricePrecision, getQuantityPrecision } from './utils/currencyInfo';

// Constants for error handling
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds
const REQUEST_TIMEOUT = 30000; // 30 seconds

interface BotError extends Error {
  code?: string;
  cause?: Error;
}

/**
 * Sleep utility function
 * @param ms milliseconds to sleep
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry wrapper for API calls
 * @param operation function to retry
 * @param context context for error messages
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  let retries = 0;
  
  while (retries < MAX_RETRIES) {
    try {
      const result = await Promise.race([
        operation(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), REQUEST_TIMEOUT)
        )
      ]) as T;
      
      return result;
    } catch (err) {
      retries++;
      const error = err as BotError;
      
      logError(`Attempt ${retries}/${MAX_RETRIES} failed for ${context}`);
      logError(`Error: ${error.message}`);
      if (error.cause) {
        logError(`Cause: ${error.cause.message}`);
      }

      if (retries === MAX_RETRIES) {
        throw new Error(`Failed after ${MAX_RETRIES} attempts: ${context} - ${error.message}`);
      }

      debug(`Waiting ${RETRY_DELAY}ms before retry...`);
      await sleep(RETRY_DELAY * retries); // Exponential backoff
    }
  }

  throw new Error(`Unexpected error in retry wrapper: ${context}`);
}

/**
 * Production bot
 */
export class Bot {
  private strategyConfigs: StrategyConfig[];

  private exchangeInfo: ExchangeInfo<FuturesOrderType_LT>;
  private accountInfo: FuturesAccountInfoResult;
  private hasOpenPosition: { [pair: string]: boolean };

  // Counter to fix the max duration of each trade
  private counters: { [symbol: string]: Counter };

  // Time
  private currentDay: string;
  private currentMonth: string;
  private lastDayBalance: number;
  private lastMonthBalance: number;
  private currentBalance: number; // temp balance

  constructor(tradeConfigs: StrategyConfig[]) {
    this.strategyConfigs = tradeConfigs;
    this.counters = {};
    this.hasOpenPosition = {};
    this.currentDay = dayjs(Date.now()).format('DD/MM/YYYY');
    this.currentMonth = dayjs(Date.now()).format('MM/YYYY');
  }

  /**
   * Initialize leverage and margin settings for a trading pair
   * @param pair trading pair
   * @param leverage leverage value
   */
  private async initializePairSettings(pair: string, leverage: number): Promise<void> {
    try {
      await withRetry(
        () => binanceClient.futuresLeverage({
          symbol: pair,
          leverage: leverage || 1,
        }),
        `Setting leverage for ${pair}`
      );
      log(`Leverage for ${pair} is set to ${leverage || 1}`);

      try {
        await withRetry(
          () => binanceClient.futuresMarginType({
            symbol: pair,
            marginType: 'ISOLATED',
          }),
          `Setting margin type for ${pair}`
        );
        log(`Margin type for ${pair} is set to ISOLATED`);
      } catch (err) {
        // If the error message indicates margin type is already set, we can ignore it
        if (err.message.includes('No need to change margin type')) {
          log(`Margin type for ${pair} is already set to ISOLATED`);
        } else {
          log(err.message);
          // If it's a different error, we should still throw it
          throw err;
        }
      }
      
      this.hasOpenPosition[pair] = false;
    } catch (err) {
      logError(`Failed to initialize settings for ${pair}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Prepare the account
   */
  public async prepare(): Promise<void> {
    try {
      // Initialize settings for each trading pair
      await Promise.all(
        this.strategyConfigs.map(({ asset, base, leverage }) =>
          this.initializePairSettings(asset + base, leverage)
        )
      );

      // Initialize the counters
      this.strategyConfigs.forEach(({ asset, base, maxTradeDuration }) => {
        if (maxTradeDuration) {
          this.counters[asset + base] = new Counter(maxTradeDuration);
        }
      });
    } catch (err) {
      logError('Failed to prepare bot:', err);
      throw err;
    }
  }

  /**
   * Main function
   */
  public async run(): Promise<void> {
    try {
      log('====================== 💵 BINANCE BOT TRADING 💵 ======================');

      // Get the exchange info with retry
      this.exchangeInfo = await withRetry(
        () => binanceClient.futuresExchangeInfo(),
        'Fetching exchange info'
      );

      // Store account information
      const accountBalance = await withRetry(
        async () => {
          const balances = await binanceClient.futuresAccountBalance();
          return balances.find(b => b.asset === this.strategyConfigs[0].base);
        },
        'Fetching account balance'
      );

      if (!accountBalance) {
        throw new Error(`Balance not found for ${this.strategyConfigs[0].base}`);
      }

      this.currentBalance = Number(accountBalance.balance);
      this.lastMonthBalance = this.currentBalance;
      this.lastDayBalance = this.currentBalance;

      // Setup websocket connections for each trading pair
      this.strategyConfigs.forEach((strategyConfig) => {
        const pair = strategyConfig.asset + strategyConfig.base;
        log(`The bot trades the pair ${pair}`);

        this.setupWebsocketConnection(strategyConfig);
      });
    } catch (err) {
      logError('Fatal error in bot run:', err);
      throw err;
    }
  }

  /**
   * Setup websocket connection for a trading pair
   * @param strategyConfig configuration for the trading pair
   */
  private setupWebsocketConnection(strategyConfig: StrategyConfig): void {
    const pair = strategyConfig.asset + strategyConfig.base;

    binanceClient.ws.futuresCandles(pair, strategyConfig.loopInterval, async (candle) => {
      try {
        if (candle.isFinal) {
          debug(`Received final candle for ${pair}`);
          debug(JSON.stringify(candle, null, 2));
        }

        // Manage open orders with retry
        await this.manageOpenOrders(pair);

        if (candle.isFinal) {
          await this.processFinalCandle(strategyConfig, candle);
        }
      } catch (err) {
        logError(`Error processing candle for ${pair}:`, err);
        // Don't throw here to keep the websocket connection alive
      }
    });
  }

  /**
   * Process a final candle
   * @param strategyConfig configuration for the trading pair
   * @param candle the candle data
   */
  private async processFinalCandle(
    strategyConfig: StrategyConfig,
    candle: any
  ): Promise<void> {
    const pair = strategyConfig.asset + strategyConfig.base;

    try {
      // Load candle data for all timeframes
      const candlesMultiTimeFrames = await loadCandlesMultiTimeFramesFromAPI(
        pair,
        Array.from(
          new Set<CandleChartInterval>([
            ...strategyConfig.indicatorIntervals,
            strategyConfig.loopInterval,
          ])
        ),
        binanceClient
      );

      await this.trade(strategyConfig, Number(candle.close), candlesMultiTimeFrames);

      // Update current balance
      const accountBalance = await withRetry(
        async () => {
          const balances = await binanceClient.futuresAccountBalance();
          return balances.find(b => b.asset === this.strategyConfigs[0].base);
        },
        'Updating account balance'
      );

      if (accountBalance) {
        this.currentBalance = Number(accountBalance.balance);
      }

      // Check for day/month changes
      this.checkTimeChanges(candle);
    } catch (err) {
      logError(`Error processing final candle for ${pair}:`, err);
    }
  }

  /**
   * Check for day/month changes and send reports
   * @param candle the candle data
   */
  private checkTimeChanges(candle: any): void {
    const candleDay = dayjs(new Date(candle.closeTime)).format('DD/MM/YYYY');
    const candleMonth = dayjs(new Date(candle.closeTime)).format('MM/YYYY');

    if (candleDay !== this.currentDay) {
      this.sendDailyResult();
      this.currentDay = candleDay;
    }

    if (candleMonth !== this.currentMonth) {
      this.sendMonthResult();
      this.currentMonth = candleMonth;
    }
  }

  /**
   * Place an order with retry mechanism
   * @param orderParams order parameters
   * @param context context for error messages
   */
  private async placeOrder(
    orderParams: any,
    context: string
  ): Promise<FuturesOrder> {
    return withRetry(
      () => binanceClient.futuresOrder(orderParams),
      `Placing ${orderParams.side} ${orderParams.type} order for ${orderParams.symbol} - ${context}`
    );
  }

  /**
   * Check if a position has been closed
   * @param pair trading pair
   */
  private async manageOpenOrders(pair: string): Promise<void> {
    try {
      this.accountInfo = await withRetry(
        () => binanceClient.futuresAccountInfo(),
        'Fetching account info'
      );

      const position = this.accountInfo.positions.find(
        (position) => position.symbol === pair
      );

      if (!position) {
        throw new Error(`Position not found for ${pair}`);
      }

      const hasOpenPosition = Number(position.positionAmt) !== 0;

      if (this.hasOpenPosition[pair] && !hasOpenPosition) {
        this.hasOpenPosition[pair] = false;
        await this.closeOpenOrders(pair);
        if (this.counters[pair]) {
          this.counters[pair].reset();
        }
      }
    } catch (err) {
      logError(`Error managing open orders for ${pair}:`, err);
      throw err;
    }
  }

  /**
   * Close all open orders for a trading pair
   * @param pair trading pair
   */
  private async closeOpenOrders(pair: string): Promise<void> {
    try {
      await withRetry(
        () => binanceClient.futuresCancelAllOpenOrders({ symbol: pair }),
        `Closing all open orders for ${pair}`
      );
      log(`Closed all open orders for ${pair}`);
    } catch (err) {
      logError(`Error closing open orders for ${pair}:`, err);
      throw err;
    }
  }

  /**
   * Main function (long/short, open/close orders)
   * @param strategyConfig
   * @param currentPrice
   * @param candles
   */
  private async trade(
    strategyConfig: StrategyConfig,
    currentPrice: number,
    candles: CandlesDataMultiTimeFrames
  ) {
    const {
      asset,
      base,
      risk,
      buyStrategy,
      sellStrategy,
      exitStrategy,
      trendFilter,
      riskManagement,
      tradingSessions,
      canOpenNewPositionToCloseLast,
      allowPyramiding,
      maxPyramidingAllocation,
      unidirectional,
      loopInterval,
      maxTradeDuration,
    } = strategyConfig;
    const pair = asset + base;

    try {
      // Update the account info
      this.accountInfo = await withRetry(
        () => binanceClient.futuresAccountInfo(),
        'Fetching account info for trade'
      );

      // Balance information
      const balances = this.accountInfo.assets;
      const { walletBalance: assetBalance, availableBalance } = balances.find(
        (balance) => balance.asset === base
      );

      // Position information
      const positions = this.accountInfo.positions;
      const position = positions.find((position) => position.symbol === pair);
      const hasLongPosition = Number(position.positionAmt) > 0;
      const hasShortPosition = Number(position.positionAmt) < 0;
      const positionSize = Math.abs(Number(position.positionAmt));
      const positionEntryPrice = Number(position.entryPrice);

      // Add debug logs for position state
      debug(`Current position state for ${pair}:`);
      debug(`- Has long position: ${hasLongPosition}`);
      debug(`- Has short position: ${hasShortPosition}`);
      debug(`- Position size: ${positionSize}`);
      debug(`- Entry price: ${positionEntryPrice}`);
      debug(`- Current price: ${currentPrice}`);

      // Open Orders
      const currentOpenOrders = await withRetry(
        () => binanceClient.futuresOpenOrders({ symbol: pair }),
        'Fetching open orders'
      );

      // Log open orders
      debug(`Open orders for ${pair}: ${currentOpenOrders.length}`);
      if (currentOpenOrders.length > 0) {
        currentOpenOrders.forEach(order => {
          debug(`- Order: ${order.side} ${order.type} at ${order.price}, amount: ${order.origQty}`);
        });
      }

      // Check the trend
      const useLongPosition = trendFilter ? trendFilter(candles) === 1 : true;
      const useShortPosition = trendFilter ? trendFilter(candles) === -1 : true;

      // Log trend state
      debug(`Trend state for ${pair}:`);
      debug(`- Can use long position: ${useLongPosition}`);
      debug(`- Can use short position: ${useShortPosition}`);

      // Conditions to take or not a position
      const canAddToPosition = allowPyramiding
        ? Number(position.initialMargin) + Number(assetBalance) * risk <=
        Number(assetBalance) * maxPyramidingAllocation
        : false;
      const canTakeLongPosition =
        (canOpenNewPositionToCloseLast && hasShortPosition) ||
        (!canOpenNewPositionToCloseLast &&
          hasShortPosition &&
          currentOpenOrders.length === 0) ||
        (!allowPyramiding && !hasLongPosition) ||
        (allowPyramiding && hasShortPosition && currentOpenOrders.length === 0) ||
        (allowPyramiding &&
          hasShortPosition &&
          currentOpenOrders.length > 0 &&
          canOpenNewPositionToCloseLast);
      const canTakeShortPosition =
        (canOpenNewPositionToCloseLast && hasLongPosition) ||
        (!canOpenNewPositionToCloseLast &&
          hasLongPosition &&
          currentOpenOrders.length === 0) ||
        (!allowPyramiding && !hasShortPosition) ||
        (allowPyramiding && hasLongPosition && currentOpenOrders.length === 0) ||
        (allowPyramiding &&
          hasLongPosition &&
          currentOpenOrders.length > 0 &&
          canOpenNewPositionToCloseLast);

      // Log strategy signals
      if (buyStrategy) {
        const buySignal = buyStrategy(candles);
        debug(`Buy strategy signal for ${pair}: ${buySignal ? 'YES' : 'NO'}`);
      }
      if (sellStrategy) {
        const sellSignal = sellStrategy(candles);
        debug(`Sell strategy signal for ${pair}: ${sellSignal ? 'YES' : 'NO'}`);
      }

      // Check if we're in a valid trading session
      const isValidTradingSession = !tradingSessions || isOnTradingSession(
        candles[loopInterval][candles[loopInterval].length - 1].closeTime,
        tradingSessions
      );
      debug(`Valid trading session: ${isValidTradingSession}`);

      // Log position taking conditions
      debug(`Position taking conditions for ${pair}:`);
      debug(`- Can add to position: ${canAddToPosition}`);
      debug(`- Can take long position: ${canTakeLongPosition}`);
      debug(`- Can take short position: ${canTakeShortPosition}`);

      // Precision
      const pricePrecision = getPricePrecision(pair, this.exchangeInfo);
      const quantityPrecision = getQuantityPrecision(pair, this.exchangeInfo);

      // The current position is too long
      if (
        maxTradeDuration &&
        (hasShortPosition || hasLongPosition) &&
        this.counters[pair]
      ) {
        this.counters[pair].decrement();
        if (this.counters[pair].getValue() == 0) {
          await this.placeOrder({
            symbol: pair,
            type: OrderType.MARKET,
            quantity: String(positionSize),
            side: hasLongPosition ? OrderSide.SELL : OrderSide.BUY,
          }, 'Max duration close');
          log(
            `The position on ${pair} is longer that the maximum authorized duration.`
          );
          return;
        }
      }

      // Reset the counter if a previous trade close the position
      if (
        maxTradeDuration &&
        !hasLongPosition &&
        !hasShortPosition &&
        this.counters[pair].getValue() < maxTradeDuration
      ) {
        this.counters[pair].reset();
      }

      if (
        (isValidTradingSession || positionSize !== 0) &&
        canTakeLongPosition &&
        buyStrategy(candles)
      ) {
        // Take the profit and not open a new position
        if (hasShortPosition && unidirectional) {
          await this.placeOrder({
            side: OrderSide.BUY,
            type: OrderType.MARKET,
            symbol: pair,
            quantity: String(positionSize),
          }, 'Unidirectional close');
          return;
        }

        // Do not trade with long position if the trend is down
        if (!useLongPosition) return;

        // Do not add to the current position if the allocation is over the max allocation
        if (allowPyramiding && hasLongPosition && !canAddToPosition) return;

        // Close the open orders of the last trade
        if (hasShortPosition && currentOpenOrders.length > 0) {
          await this.closeOpenOrders(pair);
        }

        // Calculate TP and SL
        let { takeProfits, stopLoss } = exitStrategy
          ? exitStrategy(
            currentPrice,
            candles,
            pricePrecision,
            OrderSide.BUY,
            this.exchangeInfo
          )
          : { takeProfits: [], stopLoss: null };

        //Calculate the quantity for the position according to the risk management of the strategy
        let quantity = riskManagement({
          asset,
          base,
          balance: allowPyramiding
            ? Number(assetBalance)
            : Number(availableBalance),
          risk,
          enterPrice: currentPrice,
          stopLossPrice: stopLoss,
          exchangeInfo: this.exchangeInfo,
        });

        try {
          // Place the market order first and wait for confirmation
          const marketOrder = await this.placeOrder({
            side: OrderSide.BUY,
            type: OrderType.MARKET,
            symbol: pair,
            quantity: String(
              hasShortPosition ? quantity - positionSize : quantity
            ),
          }, 'Long entry');

          // Verify the position was actually opened
          const positionInfo = await withRetry(
            async () => {
              const posRisk = await binanceClient.futuresPositionRisk({ symbol: pair });
              return posRisk[0];
            },
            'Verifying position'
          );

          const actualPositionSize = Math.abs(Number(positionInfo.positionAmt));
          const hasPosition = actualPositionSize > 0;
          const expectedSize = hasShortPosition ? quantity - positionSize : quantity;

          // Update position tracking state
          this.hasOpenPosition[pair] = hasPosition;

          if (!hasPosition) {
            logError(`Market order placed but position was not opened for ${pair}`);
            throw new Error('Market order was placed but position was not opened');
          }

          // Verify position size matches expected
          if (Math.abs(actualPositionSize - expectedSize) > Number('1e-' + quantityPrecision)) {
            logError(`Position size mismatch for ${pair}. Expected: ${expectedSize}, Actual: ${actualPositionSize}`);
            // Don't throw here, just log the warning as small differences may occur due to fees/precision
          }

          debug(`Position verified for ${pair}:`);
          debug(`- Position size: ${actualPositionSize}`);
          debug(`- Entry price: ${positionInfo.entryPrice}`);
          debug(`- Liquidation price: ${positionInfo.liquidationPrice}`);

          // Only proceed with take profits and stop loss if market order was successful
          if (marketOrder) {
            if (takeProfits.length > 0) {
              try {
                // Create the take profit orders
                for (const { price, quantityPercentage } of takeProfits) {
                  await this.placeOrder({
                    side: OrderSide.SELL,
                    type: OrderType.LIMIT,
                    symbol: pair,
                    price: price.toString(),
                    quantity: String(
                      decimalFloor(
                        quantity * quantityPercentage,
                        quantityPrecision
                      )
                    ),
                    timeInForce: TimeInForce.GTC
                  }, 'Take profit');
                }
              } catch (err) {
                logError(`Error placing take profit orders. Closing position...`);
                // Close the position if TP orders fail
                await this.placeOrder({
                  side: OrderSide.SELL,
                  type: OrderType.MARKET,
                  symbol: pair,
                  quantity: String(quantity),
                }, 'Emergency close after TP order failure');
                throw err;
              }
            }

            if (stopLoss) {
              try {
                if (takeProfits.length > 1) {
                  await this.placeOrder({
                    side: OrderSide.SELL,
                    type: OrderType.STOP_MARKET,
                    symbol: pair,
                    stopPrice: stopLoss.toString(),
                    closePosition: 'true',
                  }, 'Stop loss');
                } else {
                  await this.placeOrder({
                    side: OrderSide.SELL,
                    type: OrderType.STOP,
                    symbol: pair,
                    stopPrice: stopLoss.toString(),
                    price: stopLoss.toString(),
                    quantity: String(quantity),
                  }, 'Stop loss');
                }
              } catch (err) {
                logError(`Error placing stop loss order. Closing position...`);
                // Close the position if SL order fails
                await this.placeOrder({
                  side: OrderSide.SELL,
                  type: OrderType.MARKET,
                  symbol: pair,
                  quantity: String(quantity),
                }, 'Emergency close after SL order failure');
                throw err;
              }
            }

            // Only log after everything is successful
            logBuySellExecutionOrder(
              OrderSide.BUY,
              asset,
              base,
              currentPrice,
              quantity,
              takeProfits,
              stopLoss
            );

            // Verify all orders were placed
            const finalOpenOrders = await withRetry(
              () => binanceClient.futuresOpenOrders({ symbol: pair }),
              'Verifying final orders'
            );

            const expectedOrderCount = takeProfits.length + (stopLoss ? 1 : 0);
            if (finalOpenOrders.length !== expectedOrderCount) {
              logError(`Order count mismatch for ${pair}. Expected: ${expectedOrderCount}, Actual: ${finalOpenOrders.length}`);
              debug('Current open orders:');
              finalOpenOrders.forEach(order => {
                debug(`- ${order.side} ${order.type} at ${order.price}, amount: ${order.origQty}`);
              });
            }
          }
        } catch (err) {
          logError(`Error placing long orders for ${pair}:`, err);
          throw err;
        }
      } else if (
        (isValidTradingSession || positionSize !== 0) &&
        canTakeShortPosition &&
        sellStrategy(candles)
      ) {
        // Take the profit and not open a new position
        if (hasLongPosition && unidirectional) {
          await this.placeOrder({
            side: OrderSide.SELL,
            type: OrderType.MARKET,
            symbol: pair,
            quantity: String(positionSize),
          }, 'Unidirectional close');
          return;
        }

        // Do not trade with short position if the trend is up
        if (!useShortPosition) return;

        // Do not add to the current position if the allocation is over the max allocation
        if (allowPyramiding && hasShortPosition && !canAddToPosition) return;

        // Close the open orders of the last trade
        if (hasLongPosition && currentOpenOrders.length > 0) {
          await this.closeOpenOrders(pair);
        }

        // Calculate TP and SL
        let { takeProfits, stopLoss } = exitStrategy
          ? exitStrategy(
            currentPrice,
            candles,
            pricePrecision,
            OrderSide.SELL,
            this.exchangeInfo
          )
          : { takeProfits: [], stopLoss: null };

        // Calculate the quantity for the position according to the risk management of the strategy
        let quantity = riskManagement({
          asset,
          base,
          balance: allowPyramiding
            ? Number(assetBalance)
            : Number(availableBalance),
          risk,
          enterPrice: currentPrice,
          stopLossPrice: stopLoss,
          exchangeInfo: this.exchangeInfo,
        });

        try {
          // Place the market order first and wait for confirmation
          const marketOrder = await this.placeOrder({
            side: OrderSide.SELL,
            type: OrderType.MARKET,
            symbol: pair,
            quantity: String(
              hasLongPosition ? quantity - positionSize : quantity
            ),
          }, 'Short entry');

          // Verify the position was actually opened
          const positionInfo = await withRetry(
            async () => {
              const posRisk = await binanceClient.futuresPositionRisk({ symbol: pair });
              return posRisk[0];
            },
            'Verifying position'
          );

          const actualPositionSize = Math.abs(Number(positionInfo.positionAmt));
          const hasPosition = actualPositionSize > 0;
          const expectedSize = hasLongPosition ? quantity - positionSize : quantity;

          // Update position tracking state
          this.hasOpenPosition[pair] = hasPosition;

          if (!hasPosition) {
            logError(`Market order placed but position was not opened for ${pair}`);
            throw new Error('Market order was placed but position was not opened');
          }

          // Verify position size matches expected
          if (Math.abs(actualPositionSize - expectedSize) > Number('1e-' + quantityPrecision)) {
            logError(`Position size mismatch for ${pair}. Expected: ${expectedSize}, Actual: ${actualPositionSize}`);
            // Don't throw here, just log the warning as small differences may occur due to fees/precision
          }

          debug(`Position verified for ${pair}:`);
          debug(`- Position size: ${actualPositionSize}`);
          debug(`- Entry price: ${positionInfo.entryPrice}`);
          debug(`- Liquidation price: ${positionInfo.liquidationPrice}`);

          // Only proceed with take profits and stop loss if market order was successful
          if (marketOrder) {
            if (takeProfits.length > 0) {
              try {
                // Create the take profit orders
                for (const { price, quantityPercentage } of takeProfits) {
                  await this.placeOrder({
                    side: OrderSide.BUY,
                    type: OrderType.LIMIT,
                    symbol: pair,
                    price: price.toString(),
                    quantity: String(
                      decimalFloor(
                        quantity * quantityPercentage,
                        quantityPrecision
                      )
                    ),
                    timeInForce: TimeInForce.GTC
                  }, 'Take profit');
                }
              } catch (err) {
                logError(`Error placing take profit orders. Closing position...`);
                // Close the position if TP orders fail
                await this.placeOrder({
                  side: OrderSide.BUY,
                  type: OrderType.MARKET,
                  symbol: pair,
                  quantity: String(quantity),
                }, 'Emergency close after TP order failure');
                throw err;
              }
            }

            if (stopLoss) {
              try {
                if (takeProfits.length > 1) {
                  await this.placeOrder({
                    side: OrderSide.BUY,
                    type: OrderType.STOP_MARKET,
                    symbol: pair,
                    stopPrice: stopLoss.toString(),
                    closePosition: 'true',
                  }, 'Stop loss');
                } else {
                  await this.placeOrder({
                    side: OrderSide.BUY,
                    type: OrderType.STOP,
                    symbol: pair,
                    stopPrice: stopLoss.toString(),
                    price: stopLoss.toString(),
                    quantity: String(quantity),
                  }, 'Stop loss');
                }
              } catch (err) {
                logError(`Error placing stop loss order. Closing position...`);
                // Close the position if SL order fails
                await this.placeOrder({
                  side: OrderSide.BUY,
                  type: OrderType.MARKET,
                  symbol: pair,
                  quantity: String(quantity),
                }, 'Emergency close after SL order failure');
                throw err;
              }
            }

            // Only log after everything is successful
            logBuySellExecutionOrder(
              OrderSide.SELL,
              asset,
              base,
              currentPrice,
              quantity,
              takeProfits,
              stopLoss
            );

            // Verify all orders were placed
            const finalOpenOrders = await withRetry(
              () => binanceClient.futuresOpenOrders({ symbol: pair }),
              'Verifying final orders'
            );

            const expectedOrderCount = takeProfits.length + (stopLoss ? 1 : 0);
            if (finalOpenOrders.length !== expectedOrderCount) {
              logError(`Order count mismatch for ${pair}. Expected: ${expectedOrderCount}, Actual: ${finalOpenOrders.length}`);
              debug('Current open orders:');
              finalOpenOrders.forEach(order => {
                debug(`- ${order.side} ${order.type} at ${order.price}, amount: ${order.origQty}`);
              });
            }
          }
        } catch (err) {
          logError(`Error placing short orders for ${pair}:`, err);
          throw err;
        }
      }
    } catch (err) {
      logError(`Error in trade function for ${pair}:`, err);
      throw err;
    }
  }

  /**
   * Send the results of the day to the telegram channel
   */
  private sendDailyResult() {
    let performance = decimalFloor(
      ((this.currentBalance - this.lastDayBalance) / this.lastDayBalance) * 100,
      2
    );

    let emoji = performance >= 0 ? '🟢' : '🔴';
    let message = `Day result of ${this.currentDay}: ${performance > 0 ? `<b>+${performance}%</b>` : `${performance}%`
      } ${emoji}`;

    sendTelegramMessage(message);
  }

  /**
   * Send the results of the month to the telegram channel
   */
  private sendMonthResult() {
    let performance = decimalFloor(
      ((this.currentBalance - this.lastMonthBalance) / this.lastMonthBalance) *
      100,
      2
    );

    let emoji =
      performance > 30
        ? '🤩'
        : performance > 20
          ? '🤑'
          : performance > 10
            ? '😍'
            : performance > 0
              ? '🥰'
              : performance > -10
                ? '😢'
                : performance > -20
                  ? '😰'
                  : '😭';

    let message =
      `<b>MONTH RESULT - ${this.currentMonth}</b>` +
      '\n' +
      `${performance > 0 ? `+${performance}%` : `${performance}%`} ${emoji}`;

    sendTelegramMessage(message);
  }
}
