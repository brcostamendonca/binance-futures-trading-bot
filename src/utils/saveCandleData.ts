import path from 'path';
import fs from 'fs';
import dayjs from 'dayjs';
import { CandleChartInterval } from 'binance-api-node';
import { timeFrameToMinutes } from './timeFrame';
import { binanceClient } from '../init';
import { error as logError, debug } from './log';

// Constants
const MAX_LOADED_CANDLE_DATA = 500; // The maximum number of candles that can be fetch from the api
const MAX_REQUEST_PER_MINUTES = 2400;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds
const REQUEST_TIMEOUT = 30000; // 30 seconds

interface FetchError extends Error {
  code?: string;
  cause?: Error;
}

/**
 * Interface representing a candle from Binance Futures API
 * All numeric values are returned as strings to preserve precision
 */
interface BinanceCandle {
  /** Kline/candle open timestamp in milliseconds */
  openTime: number;
  /** Opening price */
  open: string;
  /** Highest price during the interval */
  high: string;
  /** Lowest price during the interval */
  low: string;
  /** Closing price */
  close: string;
  /** Trading volume in base asset */
  volume: string;
  /** Kline/candle close timestamp in milliseconds */
  closeTime: number;
  /** Quote asset volume */
  quoteVolume: string;
  /** Number of trades during the interval */
  trades: number;
  /** Taker buy base asset volume */
  baseAssetVolume: string;
  /** Taker buy quote asset volume */
  quoteAssetVolume: string;
  /** Can be ignored, exists for compatibility */
  isFinal?: boolean;
}

/**
 * Sleep utility function
 * @param ms milliseconds to sleep
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const dataDirectory = path.resolve(process.cwd(), 'data');

/**
 * Get the last candle date from CSV file
 * @param csvFile path to CSV file
 * @returns timestamp of last candle or default start date
 */
function getLastCandleDate(csvFile: string): number {
  try {
    if (!fs.existsSync(csvFile)) {
      // Oldest date from the binance futures candlestick data
      return dayjs('2020-01-01 00:00:00', 'YYYY-MM-DD HH:mm:ss').valueOf();
    }

    const data = fs.readFileSync(csvFile);
    const content = data.toString().split('\n');

    if (content.length > 1) {
      const lastCandle = content[1];
      const lastDate = lastCandle.split(',')[1];
      return dayjs(lastDate, 'YYYY-MM-DD HH:mm:ss').valueOf();
    }

    return dayjs('2020-01-01 00:00:00', 'YYYY-MM-DD HH:mm:ss').valueOf();
  } catch (err) {
    logError(`Error reading last candle date from ${csvFile}: ${err.message}`);
    // Return default date on error
    return dayjs('2020-01-01 00:00:00', 'YYYY-MM-DD HH:mm:ss').valueOf();
  }
}

/**
 * Append data at the beginning of the csv file
 * @param newData data to append
 * @param csvFile target CSV file
 */
function appendToCsvFile(newData: string, csvFile: string): void {
  try {
    if (fs.existsSync(csvFile)) {
      const oldData = fs.readFileSync(csvFile);
      if (oldData.length === 0) {
        fs.writeFileSync(csvFile, newData);
      } else {
        const headers = [
          'symbol',
          'openTime',
          'closeTime',
          'open',
          'high',
          'low',
          'close',
          'volume',
        ];
        const fullData =
          headers.join(',') +
          '\n' +
          newData +
          oldData.toString().split('\n').slice(1).join('\n');
        fs.writeFileSync(csvFile, fullData);
      }
    } else {
      fs.writeFileSync(csvFile, newData);
    }
  } catch (err) {
    logError(`Error appending data to ${csvFile}: ${err.message}`);
    throw err; // Re-throw to handle in calling function
  }
}

/**
 * Fetch candle data with retry mechanism
 * @param symbol trading pair symbol
 * @param timeFrame candle interval
 * @param startTime start timestamp
 * @param endTime end timestamp
 * @returns array of candle data
 */
async function fetchCandlesWithRetry(
  symbol: string,
  timeFrame: CandleChartInterval,
  startTime: number,
  endTime: number
): Promise<CandleData[]> {
  let retries = 0;
  
  while (retries < MAX_RETRIES) {
    try {
      const candles = await Promise.race([
        binanceClient.futuresCandles({
          symbol,
          interval: timeFrame,
          startTime,
          endTime,
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), REQUEST_TIMEOUT)
        )
      ]) as BinanceCandle[];

      return candles.map((c) => ({
        symbol,
        openTime: dayjs(c.openTime).toDate(),
        closeTime: dayjs(c.closeTime).toDate(),
        interval: timeFrame,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      })).reverse();

    } catch (err) {
      retries++;
      const error = err as FetchError;
      
      // Log the error with details
      logError(`Attempt ${retries}/${MAX_RETRIES} failed for ${symbol} ${timeFrame}`);
      logError(`Error: ${error.message}`);
      if (error.cause) {
        logError(`Cause: ${error.cause.message}`);
      }

      // If we've exhausted retries, throw the error
      if (retries === MAX_RETRIES) {
        throw new Error(`Failed to fetch candle data after ${MAX_RETRIES} attempts: ${error.message}`);
      }

      // Wait before retrying
      debug(`Waiting ${RETRY_DELAY}ms before retry...`);
      await sleep(RETRY_DELAY * retries); // Exponential backoff
    }
  }

  throw new Error('Unexpected error in fetchCandlesWithRetry');
}

/**
 * Fetch the candle data from api and store then into csv file
 * @param symbol trading pair symbol
 * @param timeFrame candle interval
 */
export async function saveCandleDataFromAPI(
  symbol: string,
  timeFrame: CandleChartInterval
): Promise<void> {
  try {
    // Ensure directories exist
    if (!fs.existsSync(dataDirectory)) {
      fs.mkdirSync(dataDirectory);
    }

    const symbolDir = path.join(dataDirectory, symbol);
    if (!fs.existsSync(symbolDir)) {
      fs.mkdirSync(symbolDir);
    }

    const dataFile = path.join(dataDirectory, symbol, `_${timeFrame}.csv`);
    const lastDate = getLastCandleDate(dataFile);
    const today = Date.now();

    // Check if data is up to date
    if (lastDate > dayjs(today).subtract(1, 'day').valueOf()) {
      debug(`Data is up to date for ${symbol} ${timeFrame}`);
      return;
    }

    const delay = 60000 / MAX_REQUEST_PER_MINUTES;
    let tempTimeStamp = lastDate;
    const timeStamps: number[] = [];

    // Calculate time fragments
    while (tempTimeStamp < dayjs(today).subtract(1, 'day').valueOf()) {
      timeStamps.push(tempTimeStamp);
      tempTimeStamp += MAX_LOADED_CANDLE_DATA * timeFrameToMinutes(timeFrame) * 60000;
    }

    // Process each time fragment with proper error handling
    for (let i = 0; i < timeStamps.length; i++) {
      try {
        await sleep(i * delay); // Rate limiting delay

        const endTime = i + 1 < timeStamps.length ? timeStamps[i + 1] : today;
        const fragment = await fetchCandlesWithRetry(
          symbol,
          timeFrame,
          timeStamps[i],
          endTime
        );

        if (fragment && fragment.length > 0) {
          const dataString = fragment
            .map(
              ({ symbol, openTime, closeTime, open, high, low, close, volume }) =>
                [
                  symbol,
                  dayjs(openTime).format('YYYY-MM-DD HH:mm:ss'),
                  dayjs(closeTime).format('YYYY-MM-DD HH:mm:ss'),
                  open,
                  high,
                  low,
                  close,
                  volume,
                ].join(',')
            )
            .join('\n');

          appendToCsvFile(dataString + '\n', dataFile);
          debug(`Successfully saved fragment ${i + 1}/${timeStamps.length} for ${symbol} ${timeFrame}`);
        }
      } catch (err) {
        logError(`Error processing fragment ${i + 1}/${timeStamps.length} for ${symbol} ${timeFrame}`);
        logError(err.message);
        // Continue with next fragment instead of failing completely
        continue;
      }
    }
  } catch (err) {
    logError(`Fatal error in saveCandleDataFromAPI for ${symbol} ${timeFrame}`);
    logError(err.message);
    throw err; // Re-throw for higher-level error handling
  }
}
