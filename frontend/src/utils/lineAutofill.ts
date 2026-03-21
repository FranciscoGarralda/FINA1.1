export type FirstLineAmountMode = 'AUTO' | 'MANUAL';

export function resolveFirstLineAmountMode(nextAmount: string): FirstLineAmountMode {
  return nextAmount === '' ? 'AUTO' : 'MANUAL';
}
