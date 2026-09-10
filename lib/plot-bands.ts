export type BandDatum = {
  x: number;
  y: number | null;
  low?: number | null;
  high?: number | null;
};

// A missing nominal value or sensitivity bound ends the band; never fill across gaps.
export function splitBandRuns(data: BandDatum[], maxGap?: number) {
  const runs: BandDatum[][] = [];
  let run: BandDatum[] = [];
  for (const point of data) {
    if (
      point.y == null ||
      !Number.isFinite(point.y) ||
      point.low == null ||
      point.high == null ||
      !Number.isFinite(point.low) ||
      !Number.isFinite(point.high) ||
      point.low > point.y ||
      point.high < point.y
    ) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    if (run.length && maxGap && point.x - run.at(-1)!.x > maxGap) {
      runs.push(run);
      run = [];
    }
    run.push(point);
  }
  if (run.length) runs.push(run);
  return runs;
}
