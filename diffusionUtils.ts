
import { ScheduleType, DiffusionParams, TimestepData } from './types';

/**
 * Creates an array of N values spaced linearly between start and end.
 */
export const linspace = (start: number, end: number, n: number): number[] => {
  const count = Math.max(1, Math.floor(n));
  if (count < 2) return [start];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => start + step * i);
};

export const getBetas = (params: DiffusionParams): number[] => {
  const { betaStart, betaEnd, numTimesteps, schedule } = params;
  const n = Math.max(1, Math.floor(numTimesteps));
  let betas: number[] = [];

  switch (schedule) {
    case ScheduleType.LINEAR:
      betas = linspace(betaStart, betaEnd, n);
      break;
    case ScheduleType.QUAD:
      betas = linspace(Math.sqrt(betaStart), Math.sqrt(betaEnd), n).map(v => v * v);
      break;
    case ScheduleType.SQRT:
      betas = linspace(betaStart ** 2, betaEnd ** 2, n).map(v => Math.sqrt(v));
      break;
    case ScheduleType.CONST:
      betas = Array(n).fill(betaEnd);
      break;
    case ScheduleType.RECIP:
      betas = linspace(n, 1, n).map(v => betaEnd * (1 / v));
      break;
    case ScheduleType.LOG:
      const logStart = Math.log2(Math.max(1e-10, betaStart));
      const logEnd = Math.log2(Math.max(1e-10, betaEnd));
      betas = linspace(logStart, logEnd, n).map(v => Math.pow(2, v));
      break;
    case ScheduleType.EXP:
      const expStart = Math.pow(2, betaStart);
      const expEnd = Math.pow(2, betaEnd);
      betas = linspace(expStart, expEnd, n).map(v => Math.log2(v));
      break;
    default:
      betas = linspace(betaStart, betaEnd, n);
  }
  return betas;
};

export const calculateSchedule = (params: DiffusionParams): TimestepData[] => {
  const betas = getBetas(params);
  const results: TimestepData[] = [];
  let currentAlphaBar = 1.0;

  for (let i = 0; i < betas.length; i++) {
    const t = i + 1;
    const beta = betas[i];
    const alpha = 1 - beta;
    currentAlphaBar *= alpha;

    const oneMinusAlphaBar = 1 - currentAlphaBar;
    const snr = currentAlphaBar / (oneMinusAlphaBar || 1e-12);
    const snrDb = 10 * Math.log10(Math.max(1e-20, snr));

    results.push({
      t,
      beta,
      alpha,
      alphaBar: currentAlphaBar,
      oneMinusAlphaBar,
      sqrtAlphaBar: Math.sqrt(currentAlphaBar),
      sqrtOneMinusAlphaBar: Math.sqrt(oneMinusAlphaBar),
      snr,
      snrDb
    });
  }

  return results;
};

/**
 * Solves for betaEnd using binary search such that the final SNR dB matches the target.
 */
export const solveBetaEndForSNR = (
  targetSnrDb: number, 
  betaStart: number, 
  numTimesteps: number, 
  schedule: ScheduleType
): number => {
  let low = 0.0000001;
  let high = 0.999; 
  
  // Binary search for monotonic betaEnd
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const data = calculateSchedule({ betaStart, betaEnd: mid, numTimesteps, schedule });
    const finalSnrDb = data[data.length - 1].snrDb;
    
    // Higher betaEnd leads to lower SNR (more noise)
    if (finalSnrDb > targetSnrDb) {
      low = mid;
    } else {
      high = mid;
    }
  }
  
  return high;
};

export const downloadCSV = (data: TimestepData[]) => {
  const headers = [
    't', 'beta', 'alpha', 'alpha_bar', '1-alpha_bar', 
    'sqrt(alpha_bar)', 'sqrt(1-alpha_bar)', 'SNR', 'SNR(dB)'
  ];
  const rows = data.map(d => [
    d.t, d.beta, d.alpha, d.alphaBar, d.oneMinusAlphaBar, 
    d.sqrtAlphaBar, d.sqrtOneMinusAlphaBar, d.snr, d.snrDb
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'diffusion_schedule.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
