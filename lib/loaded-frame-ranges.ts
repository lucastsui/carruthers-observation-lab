/** Map decoded URLs to contiguous frame-index ranges on the current slider. */
export function loadedFrameRanges(urls: readonly string[], loaded: ReadonlySet<string>) {
  const ranges: { start: number; end: number; left: number; width: number }[] = [];
  for (let index = 0; index < urls.length; index++) {
    if (!loaded.has(urls[index])) continue;
    const start = index;
    while (index + 1 < urls.length && loaded.has(urls[index + 1])) index++;
    // Frame positions match the slider's index/(count - 1), with half-step cells.
    const steps = Math.max(1, urls.length - 1);
    const left = Math.max(0, (start - 0.5) / steps);
    const right = urls.length === 1 ? 1 : Math.min(1, (index + 0.5) / steps);
    ranges.push({ start, end: index, left: left * 100, width: (right - left) * 100 });
  }
  return ranges;
}
