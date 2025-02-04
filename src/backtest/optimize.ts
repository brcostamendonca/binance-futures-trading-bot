import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { BotConfig } from '../init';
import { AbstractStrategy, StrategyHyperParameters } from '../init';
import { BasicBackTestBot } from './bot';
import { sendTelegramMessage } from '../telegram';
import os from 'os';

// Performance tuning constants
const MEMORY_LIMIT = 0.8; // Use up to 80% of available memory
const MIN_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 50;

// If this is a worker thread, set environment immediately
if (!isMainThread) {
  // Set environment variables before any other imports or operations
  process.env.NODE_ENV = 'worker';
  process.env.DEBUG = 'false';

  // Disable console methods except error
  console.log = () => { };
  console.info = () => { };
  console.warn = () => { };
  console.debug = () => { };

  // Create a dummy logger for worker threads
  const dummyLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: (...args) => console.error(...args),
    log: () => { }
  };

  // Monkey patch the global logger
  global['logger'] = dummyLogger;

  try {
    const { parameters, startDate, endDate, initialCapital, strategyName } = workerData;

    // Ensure all required parameters are present with default values
    const defaultParameters = StrategyHyperParameters;
    const mergedParameters = {};

    // Merge default parameters with optimization parameters
    Object.entries(defaultParameters).forEach(([key, config]) => {
      mergedParameters[key] = {
        value: parameters[key]?.value ?? config.value
      };
    });

    const bot = new BasicBackTestBot(
      AbstractStrategy(mergedParameters),
      mergedParameters,
      strategyName,
      new Date(startDate),
      new Date(endDate),
      initialCapital,
      false // Don't generate report in worker threads
    );

    bot.prepare();

    bot.run()
      .then(() => {
        if (!bot.strategyReport) {
          throw new Error('Strategy report is null after bot run');
        }

        // Only send essential data back to main thread
        const { finalCapital, initialCapital, maxRelativeDrawdown, totalTrades,
          totalWinRate, profitFactor, totalNetProfit } = bot.strategyReport;

        parentPort.postMessage({
          strategyReport: {
            finalCapital, initialCapital, maxRelativeDrawdown, totalTrades,
            totalWinRate, profitFactor, totalNetProfit
          },
          parameters: mergedParameters
        });
      })
      .catch(error => {
        console.error('Worker Thread Error:', error);
        console.error('Error stack:', error.stack);
        parentPort.postMessage({ error: error.message });
      })
      .finally(() => {
        // Cleanup
        if (typeof bot['cleanup'] === 'function') {
          bot['cleanup']();
        }
        // Force garbage collection in worker if available
        if (global.gc) global.gc();
      });
  } catch (error) {
    console.error('Worker Thread Setup Error:', error);
    console.error('Error stack:', error.stack);
    parentPort.postMessage({ error: error.message });
  }
} else {
  // Main thread code
  const startTime = performance.now();

  if (process.env.NODE_ENV === 'test') {
    console.log('Main Thread: Loading configuration');
    const BacktestConfig = BotConfig['backtest'];
    const startDate = new Date(BacktestConfig['start_date']);
    const endDate = new Date(BacktestConfig['end_date']);
    const initialCapital = BacktestConfig['initial_capital'];
    const strategyName = BotConfig['strategy_name'];

    console.log('Main Thread Configuration:', {
      startDate,
      endDate,
      initialCapital,
      strategyName
    });

    // Dynamic worker count based on system resources
    const cpuCount = os.cpus().length;
    const MAX_WORKERS = Math.max(1, Math.min(cpuCount - 1, Math.floor(cpuCount * 0.8)));

    // Auto-tune batch size based on available memory
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const memoryBasedBatchSize = Math.floor((freeMem / totalMem) * MAX_BATCH_SIZE);
    const BATCH_SIZE = Math.max(MIN_BATCH_SIZE, Math.min(memoryBasedBatchSize, MAX_BATCH_SIZE));

    // Debug the parameters we're optimizing
    console.log('\n=== Parameters to Optimize ===');
    const parametersToOptimize = new Map();
    Object.entries(StrategyHyperParameters).forEach(([name, config]) => {
      if (config.optimization?.length > 0) {
        parametersToOptimize.set(name, {
          current: config.value,
          optimization: config.optimization,
          step: config.optimizationStep
        });
        console.log(`${name}:`, {
          current: config.value,
          optimization: config.optimization,
          step: config.optimizationStep
        });
      }
    });

    // Efficient parameter value generation with memoization
    const parameterValueCache = new Map();
    function generateParameterValues(config: any) {
      const cacheKey = JSON.stringify(config);
      if (parameterValueCache.has(cacheKey)) {
        return parameterValueCache.get(cacheKey);
      }

      const { optimization, step } = config;
      if (!optimization?.length) return [];

      let result;
      if (optimization.length === 2 &&
        typeof optimization[0] === 'number' &&
        typeof optimization[1] === 'number') {
        const [min, max] = optimization;
        const stepSize = step || 1;

        // Calculate exact number of steps
        const numSteps = Math.floor((max - min) / stepSize) + 1;
        const values = [];

        // Generate values with exact step count
        for (let i = 0; i < numSteps; i++) {
          // Ensure we don't exceed max due to floating point errors
          const value = Number(Math.min(min + i * stepSize, max).toFixed(10));
          values.push(value);
        }

        // Ensure max value is included if it wasn't due to rounding
        if (values[values.length - 1] < max) {
          values.push(Number(max.toFixed(10)));
        }

        result = values;

        // Debug output for verification
        console.log(`Range [${min}, ${max}] with step ${stepSize} generated ${values.length} values:`, values);
      } else {
        result = optimization;
      }

      parameterValueCache.set(cacheKey, result);
      return result;
    }

    // Generate parameter combinations more efficiently with iterator
    function* generateCombinations(parameters: Map<string, any>): Generator<any> {
      const entries = Array.from(parameters.entries());
      const values = entries.map(([name, config]) => {
        const vals = generateParameterValues({
          optimization: config.optimization,
          step: config.step
        });
        return vals;
      });

      // Debug: Print the number of values for each parameter
      console.log('\nParameter value counts:');
      entries.forEach(([name], index) => {
        console.log(`${name}: ${values[index].length} values (${values[index].join(', ')})`);
      });

      const totalCombinations = values.reduce((acc, arr) => acc * arr.length, 1);

      for (let i = 0; i < totalCombinations; i++) {
        const combination = {};
        let temp = i;
        for (let j = values.length - 1; j >= 0; j--) {
          const size = values[j].length;
          const index = temp % size;
          combination[entries[j][0]] = { value: values[j][index] };
          temp = Math.floor(temp / size);
        }
        yield combination;
      }
    }

    // Optimized comparison function with early exit
    function compareStrategyReport(a: StrategyReport, b: StrategyReport) {
      const roiA = (a.finalCapital - a.initialCapital) / a.initialCapital;
      const roiB = (b.finalCapital - b.initialCapital) / b.initialCapital;

      // Quick ROI comparison first
      if (roiA > roiB * 1.5) return true;
      if (roiB > roiA * 1.5) return false;

      const drawdownA = Math.abs(a.maxRelativeDrawdown);
      const drawdownB = Math.abs(b.maxRelativeDrawdown);

      const scoreA = drawdownA === 0 ? roiA : roiA / drawdownA;
      const scoreB = drawdownB === 0 ? roiB : roiB / drawdownB;

      return scoreA > scoreB;
    }

    // Enhanced worker pool with auto-scaling
    class WorkerPool {
      private workers: Worker[] = [];
      private activeWorkers = 0;
      private lastBatchDuration = 0;
      private readonly startTime: number;

      constructor(private maxWorkers: number) {
        this.startTime = Date.now();
      }

      private adjustBatchSize(duration: number) {
        this.lastBatchDuration = duration;
        // Auto-adjust batch size based on duration and memory usage
        const memUsage = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal;
        if (duration > 30000 && memUsage < MEMORY_LIMIT) {
          return Math.max(MIN_BATCH_SIZE, BATCH_SIZE * 0.8);
        } else if (duration < 10000 && memUsage < MEMORY_LIMIT * 0.7) {
          return Math.min(MAX_BATCH_SIZE, BATCH_SIZE * 1.2);
        }
        return BATCH_SIZE;
      }

      async processTask(parameters: any) {
        return new Promise((resolve, reject) => {
          const worker = new Worker(__filename, {
            workerData: {
              parameters,
              startDate,
              endDate,
              initialCapital,
              strategyName
            }
          });

          const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error('Worker timeout'));
          }, 300000); // 5 minute timeout

          worker.on('message', (result) => {
            clearTimeout(timeout);
            if (result.error) {
              reject(result.error);
            } else {
              resolve(result);
            }
            this.activeWorkers--;
            worker.terminate();
          });

          worker.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });

          worker.on('exit', (code) => {
            clearTimeout(timeout);
            if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
          });

          this.activeWorkers++;
        });
      }

      async processBatch(combinations: any[]) {
        const batchStartTime = Date.now();
        console.log(`\nProcessing batch of ${combinations.length} combinations`);

        const promises = combinations.map(params => {
          // Log the actual parameter values
          const parameterInfo = Object.entries(params)
            .map(([key, value]: [string, any]) => `${key}: ${value.value}`)
            .join(', ');
          console.log(`Spawning worker with parameters: ${parameterInfo}`);

          return this.processTask(params);
        });

        const results = await Promise.all(promises.map(p => p.catch(e => {
          console.error('Batch processing error:', e);
          return { error: e };
        })));

        const validResults = results.filter(r => typeof r === 'object' && r !== null && !('error' in r));
        const batchDuration = Date.now() - batchStartTime;
        console.log(`\nBatch completed in ${(batchDuration / 1000).toFixed(1)}s: ${validResults.length} valid results out of ${results.length} total`);

        // Adjust batch size based on performance
        this.adjustBatchSize(batchDuration);

        return validResults;
      }

      cleanup() {
        this.workers.forEach(worker => worker.terminate());
        this.workers = [];
      }

      getStats() {
        return {
          activeWorkers: this.activeWorkers,
          lastBatchDuration: this.lastBatchDuration,
          uptime: Date.now() - this.startTime
        };
      }
    }

    // Main optimization function
    async function optimize() {
      const workerPool = new WorkerPool(MAX_WORKERS);
      let bestResult = null;
      let bestParameters = null;
      let processedCount = 0;

      // Pre-generate all combinations for accurate count
      const combinations = Array.from(generateCombinations(parametersToOptimize));
      const totalCombinationsCount = combinations.length;

      console.log(`\nTotal combinations to test: ${totalCombinationsCount}`);
      console.log(`Using ${MAX_WORKERS} worker threads with batch size ${BATCH_SIZE}`);

      for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
        const batch = combinations.slice(i, i + BATCH_SIZE);
        const results = await workerPool.processBatch(batch);

        results.forEach((result: any) => {
          const { strategyReport, parameters } = result;
          if (!bestResult || compareStrategyReport(strategyReport, bestResult)) {
            bestResult = strategyReport;
            bestParameters = parameters;
            const roi = ((strategyReport.finalCapital - strategyReport.initialCapital) / strategyReport.initialCapital * 100);
            console.log('\n=== New Best Strategy Found ===');
            console.log(`ROI: ${roi.toFixed(2)}%, Max Drawdown: ${(strategyReport.maxRelativeDrawdown * 100).toFixed(2)}%`);
            console.log('Parameters:', Object.entries(parameters)
              .map(([key, value]: [string, any]) => `${key}: ${value.value}`)
              .join(', '));
          }
        });

        processedCount += batch.length;
        const progress = (processedCount / totalCombinationsCount) * 100;
        const poolStats = workerPool.getStats();
        const timePerBatch = poolStats.lastBatchDuration / 1000; // Convert to seconds
        const remainingBatches = Math.ceil((totalCombinationsCount - processedCount) / BATCH_SIZE);
        const estimatedTimeRemaining = timePerBatch * remainingBatches;

        console.log(`\nProgress: ${processedCount}/${totalCombinationsCount} (${progress.toFixed(1)}%)`);
        console.log(`Batch Duration: ${(poolStats.lastBatchDuration / 1000).toFixed(1)}s, Active Workers: ${poolStats.activeWorkers}`);
        console.log(`Estimated time remaining: ${estimatedTimeRemaining.toFixed(0)}s`);

        if (global.gc) global.gc();
      }

      workerPool.cleanup();
      return { bestResult, bestParameters, totalCombinationsCount };
    }

    // Start optimization
    optimize()
      .then(async ({ bestResult, bestParameters, totalCombinationsCount }) => {
        const endTime = performance.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        const reportMessage = `
🤖 <b>Optimization Results for ${strategyName}</b>

⏱️ Duration: ${duration} seconds
🔄 Total Combinations: ${totalCombinationsCount}

📊 <b>Best Strategy Results:</b>
• Initial Capital: $${bestResult.initialCapital.toFixed(2)}
• Final Capital: $${bestResult.finalCapital.toFixed(2)}
• ROI: ${((bestResult.finalCapital - bestResult.initialCapital) / bestResult.initialCapital * 100).toFixed(2)}%
• Total Trades: ${bestResult.totalTrades}
• Win Rate: ${bestResult.totalWinRate}%
• Profit Factor: ${bestResult.profitFactor}
• Max Drawdown: ${(bestResult.maxRelativeDrawdown).toFixed(2)}%
• Total Net Profit: $${bestResult.totalNetProfit.toFixed(2)}

🔧 <b>Optimized Parameters:</b>
${Object.entries(bestParameters)
            .map(([key, value]: [string, any]) => `• ${key}: ${value.value}`)
            .join('\n')}`;

        try {
          const originalEnv = process.env.NODE_ENV;
          process.env.NODE_ENV = 'production';
          await sendTelegramMessage(reportMessage);
          process.env.NODE_ENV = originalEnv;
        } catch (error) {
          console.error('Failed to send results to Telegram:', error);
        }

        console.log('\n================== Optimization Complete ==================');
        console.log(`Duration: ${duration} seconds`);
        console.log('Best Parameters:', JSON.stringify(bestParameters, null, 2));
        console.log('Best Results:', JSON.stringify(bestResult, null, 2));
      })
      .catch(console.error);
  }
}

