import { BotConfig } from '../init';
import { AbstractStrategy, StrategyHyperParameters } from '../init';
import { BasicBackTestBot } from './bot';

var startTime = performance.now();

if (process.env.NODE_ENV === 'test') {
  const BacktestConfig = BotConfig['backtest'];
  const startDate = new Date(BacktestConfig['start_date']);
  const endDate = new Date(BacktestConfig['end_date']);
  const initialCapital = BacktestConfig['initial_capital'];
  const strategyName = BotConfig['strategy_name'];
  const BATCH_SIZE = 10; // Number of combinations to run at once

  // Debug the parameters we're optimizing
  console.log('\n=== Parameters to Optimize ===');
  Object.entries(StrategyHyperParameters).forEach(([name, config]) => {
    if (config.optimization && config.optimization.length > 0) {
      console.log(`${name}:`, {
        current: config.value,
        optimization: config.optimization,
        step: config.optimizationStep
      });
    }
  });

  function run(parameters: HyperParameters) {
    const bot = new BasicBackTestBot(
      AbstractStrategy(parameters),
      parameters,
      strategyName,
      startDate,
      endDate,
      initialCapital,
      false
    );
    bot.prepare();
    return new Promise<[StrategyReport, HyperParameters]>((resolve, reject) => {
      bot
        .run()
        .then(() => {
          let parametersString =
            '[ ' +
            Object.entries(parameters)
              .map(
                ([parameterName, config]) => `${parameterName}: ${config.value}`
              )
              .join(', ') +
            ' ]';
          console.log(`\nCompleted run with parameters: ${parametersString}`);
          console.log(`Final Capital: ${bot.strategyReport.finalCapital}, ROI: ${((bot.strategyReport.finalCapital - bot.strategyReport.initialCapital) / bot.strategyReport.initialCapital * 100).toFixed(2)}%, Max Drawdown: ${(bot.strategyReport.maxRelativeDrawdown * 100).toFixed(2)}%`);
          resolve([bot.strategyReport, parameters]);
        })
        .catch(reject);
    });
  }

  // ========================================================================================== //

  let parameterNames = Object.keys(StrategyHyperParameters).map((name) => name);
  let parameterValues = Object.values(StrategyHyperParameters).map(
    ({ optimization, optimizationStep, value }) => {
      if (optimization && optimization.length > 0) {
        // Handle array of specific values
        if (Array.isArray(optimization) && optimization.length > 1) {
          // Handle numeric range
          if (
            typeof optimization[0] === 'number' &&
            typeof optimization[1] === 'number' &&
            optimization.length === 2 &&
            optimization[0] < optimization[1]
          ) {
            let values = [];
            let [min, max] = optimization;
            let step = optimizationStep || 1;
            for (let i = min; i <= max; i += step) {
              values.push(i);
            }
            return values;
          }
          // Handle boolean values
          else if (
            Array.isArray(optimization) &&
            optimization.length > 0 &&
            (optimization as unknown[]).every(val => typeof val === 'boolean')
          ) {
            return (optimization as unknown) as boolean[];
          }
          // Handle string values
          else if (
            Array.isArray(optimization) &&
            optimization.length > 0 &&
            (optimization as unknown[]).every(val => typeof val === 'string')
          ) {
            return (optimization as unknown) as string[];
          }
          // Return array as is for specific values
          return optimization;
        }
      }
      // If no optimization array, return empty array
      return [];
    }
  );

  // Debug the parameter values we'll be testing
  console.log('\n=== Parameter Values for Testing ===');
  parameterNames.forEach((name, index) => {
    if (parameterValues[index].length > 0) {
      console.log(`${name}:`, parameterValues[index]);
    }
  });

  // ========================================================================================== //

  let indexToOptimize: number[] = [];

  // Find the parameters index to optimize
  for (let i = 0; i < parameterValues.length; i++) {
    if (parameterValues[i].length > 0) indexToOptimize.push(i);
  }

  console.log('\n=== Parameters to Optimize (Indices) ===');
  indexToOptimize.forEach(index => {
    console.log(`${parameterNames[index]}: ${parameterValues[index].length} values`);
  });

  function* parameterCombinationsGenerator(i: number, parameters: HyperParameters): Generator<HyperParameters> {
    let currentIndexToOptimize = indexToOptimize[i];

    if (i >= indexToOptimize.length) {
      yield { ...parameters };
      return;
    }

    for (let n = 0; n < parameterValues[currentIndexToOptimize].length; n++) {
      let newParams = { ...parameters };
      newParams[parameterNames[currentIndexToOptimize]] = {
        value: parameterValues[currentIndexToOptimize][n],
      };
      yield* parameterCombinationsGenerator(i + 1, newParams);
    }
  }

  // ========================================================================================== //

  /**
   * Return true if a is better than b, else false
   */
  function compareStrategyReport(a: StrategyReport, b: StrategyReport) {
    const roi = (r: StrategyReport) =>
      (r.finalCapital - r.initialCapital) / r.initialCapital;

    const getScore = (r: StrategyReport) => {
      const roiValue = roi(r);
      const drawdown = Math.abs(r.maxRelativeDrawdown);
      // Avoid division by zero and penalize high drawdowns
      return drawdown === 0 ? roiValue : roiValue / drawdown;
    };

    const scoreA = getScore(a);
    const scoreB = getScore(b);

    console.log(`\nComparing strategies:
    Strategy A - ROI: ${(roi(a) * 100).toFixed(2)}%, Drawdown: ${(a.maxRelativeDrawdown * 100).toFixed(2)}%, Score: ${scoreA.toFixed(4)}
    Strategy B - ROI: ${(roi(b) * 100).toFixed(2)}%, Drawdown: ${(b.maxRelativeDrawdown * 100).toFixed(2)}%, Score: ${scoreB.toFixed(4)}`);

    return scoreA > scoreB;
  }

  let bestResultParameters: HyperParameters = {};
  let bestResultStrategyReport: StrategyReport = null;
  let totalCombinations = 0;
  let processedCombinations = 0;

  async function processBatch(combinations: HyperParameters[]) {
    const promises = combinations.map(parameters => run(parameters));
    const results = await Promise.all(promises);
    processedCombinations += combinations.length;

    results.forEach(([strategyReport, hyperParameters]) => {
      if (
        (Object.keys(bestResultParameters).length === 0 &&
          bestResultStrategyReport === null) ||
        compareStrategyReport(strategyReport, bestResultStrategyReport)
      ) {
        console.log('\n=== New Best Strategy Found ===');
        console.log('Parameters:', JSON.stringify(hyperParameters, null, 2));
        console.log(`ROI: ${((strategyReport.finalCapital - strategyReport.initialCapital) / strategyReport.initialCapital * 100).toFixed(2)}%`);
        console.log(`Max Drawdown: ${(strategyReport.maxRelativeDrawdown * 100).toFixed(2)}%`);
        bestResultParameters = { ...hyperParameters };  // Make a copy to ensure we don't modify it
        bestResultStrategyReport = { ...strategyReport };  // Make a copy to ensure we don't modify it
      }
    });
  }

  async function optimizeInBatches() {
    const generator = parameterCombinationsGenerator(0, { ...StrategyHyperParameters });
    let currentBatch: HyperParameters[] = [];
    let batchCount = 0;

    // Count total combinations first
    for (const _ of parameterCombinationsGenerator(0, { ...StrategyHyperParameters })) {
      totalCombinations++;
    }
    console.log(`\nTotal combinations to test: ${totalCombinations}`);

    for (const combination of generator) {
      currentBatch.push({ ...combination });  // Make a copy to ensure we don't modify the original

      if (currentBatch.length >= BATCH_SIZE) {
        batchCount++;
        console.log(`\nProcessing batch ${batchCount}... (${processedCombinations + 1}-${processedCombinations + currentBatch.length} of ${totalCombinations})`);
        await processBatch(currentBatch);
        currentBatch = [];

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }
    }

    // Process remaining combinations
    if (currentBatch.length > 0) {
      batchCount++;
      console.log(`\nProcessing final batch ${batchCount}... (${processedCombinations + 1}-${totalCombinations} of ${totalCombinations})`);
      await processBatch(currentBatch);
    }

    console.log(
      '\n================== Final Optimized Parameters =================='
    );
    console.log(JSON.stringify(bestResultParameters, null, 2));
    console.log(
      '\n================== Final Strategy Report =================='
    );
    console.log(JSON.stringify(bestResultStrategyReport, null, 2));

    var endTime = performance.now();
    console.log(
      `\nOptimization completed in ${((endTime - startTime) / 1000).toFixed(2)} seconds`
    );
    console.log(`Tested ${totalCombinations} combinations`);
    if (bestResultStrategyReport) {
      console.log(`Best ROI: ${((bestResultStrategyReport.finalCapital - bestResultStrategyReport.initialCapital) / bestResultStrategyReport.initialCapital * 100).toFixed(2)}%`);
      console.log(`Best Max Drawdown: ${(bestResultStrategyReport.maxRelativeDrawdown * 100).toFixed(2)}%`);
    }
  }

  // Start the optimization process
  optimizeInBatches().catch(console.error);
}
