export const MIN_LOG_R = -1; // 0.0001 kR; allow inspection of faint positive emission.
export const DEFAULT_WFI_LOG_R = 0; // 0.001 kR.
export const MAX_RADIANCE_KR = 270;
export const MAX_LOG_R = Math.log10(MAX_RADIANCE_KR * 1000);
export type ContourMode = 'radiance' | 're' | 'none';
export function radianceLabel(value: number) {
  return Number(value.toPrecision(4)).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  });
}
export function radianceTicks(low: number, high: number) {
  const a = 10 ** low / 1000,
    b = 10 ** high / 1000;
  const interior: number[] = [];
  for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) {
    for (const m of [1, 3]) {
      const value = m * 10 ** e,
        fraction = (Math.log10(value * 1000) - low) / (high - low);
      if (fraction > 0.075 && fraction < 0.94) interior.push(value);
    }
  }
  return [a, ...interior, b].map((value) => ({
    value,
    fraction: (Math.log10(value * 1000) - low) / (high - low),
  }));
}
export const DAWN_SECTOR = { angle_start: 157.5, angle_end: 202.5 };
export const DUSK_SECTOR = { angle_start: -22.5, angle_end: 22.5 };
