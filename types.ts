
export enum ScheduleType {
  LINEAR = 'linear',
  QUAD = 'quad',
  SQRT = 'sqrt',
  CONST = 'const',
  RECIP = 'recip',
  LOG = 'log',
  EXP = 'exp'
}

export interface DiffusionParams {
  betaStart: number;
  betaEnd: number;
  numTimesteps: number;
  schedule: ScheduleType;
}

export interface ComparisonItem extends DiffusionParams {
  id: string;
  label: string;
}

export interface TimestepData {
  t: number;
  beta: number;
  alpha: number;
  alphaBar: number;
  oneMinusAlphaBar: number;
  sqrtAlphaBar: number;
  sqrtOneMinusAlphaBar: number;
  snr: number;
  snrDb: number;
}
