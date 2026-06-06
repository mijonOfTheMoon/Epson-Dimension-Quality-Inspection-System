export type Direction = 'lower_is_better' | 'higher_is_better';
export type PerfArea = 'frontend' | 'backend' | 'database' | 'agent' | 'video';
export type AggregateKind = 'mean' | 'p95' | 'median' | 'max';
export type ResultStatus = 'verified' | 'unverifiable';
export interface BaselineMetric {
  area: PerfArea;
  metricName: string;
  value: number;
  unit: string;
  aggregate: AggregateKind;
  sampleCount: number;
  method: string;
  loadCondition: string;
  measuredAt: string;
  measurable: boolean;
  limitationNote: string | null;
}

export interface PerformanceTarget {
  area: PerfArea;
  metricName: string;
  direction: Direction;
  targetValue: number;
  targetPercent: number | null;
}

export interface OptimizationResult {
  area: PerfArea;
  metricName: string;
  baselineValue: number;
  afterValue: number;
  unit: string;
  absoluteDelta: number;
  percentDelta: number;
  meetsTarget: boolean;
  status: ResultStatus;
  statusReason: string | null;
  regression: boolean;
  followUp: string | null;
}

export interface Delta {
  absoluteDelta: number;
  percentDelta: number;
}

function isWorse(candidate: number, reference: number, direction: Direction): boolean {
  return direction === 'lower_is_better' ? candidate > reference : candidate < reference;
}

export function isTargetValid(
  baselineValue: number,
  targetValue: number,
  direction: Direction,
): boolean {
  return !isWorse(targetValue, baselineValue, direction);
}

export function isRegression(
  baselineValue: number,
  afterValue: number,
  direction: Direction,
): boolean {
  return isWorse(afterValue, baselineValue, direction);
}

export function computeDelta(baselineValue: number, afterValue: number): Delta {
  const absoluteDelta = afterValue - baselineValue;
  let percentDelta: number;
  if (baselineValue === 0) {
    percentDelta = absoluteDelta === 0 ? 0 : Number.NaN;
  } else {
    percentDelta = (absoluteDelta / baselineValue) * 100;
  }
  return { absoluteDelta, percentDelta };
}
