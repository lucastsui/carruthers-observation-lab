import { downloadText } from './research';
import { analysisCSV } from './analysis-export';
import type { Job, Saved } from './research';

// IndexedDB belongs to this browser and origin. Nothing is saved on the server.
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('carruthers-analyses', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('results', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          'Browser storage is unavailable. Download CSV or JSON instead.',
        ),
      );
  });
}
async function transaction<T>(
  write: boolean,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('results', write ? 'readwrite' : 'readonly');
      const req = operation(tx.objectStore('results'));
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = tx.onerror = () =>
        reject(
          new Error('Could not save in this browser. Download a copy instead.'),
        );
    });
  } finally {
    db.close();
  }
}
export async function storeSaved(result: Job) {
  await transaction(true, (s) =>
    s.put({
      ...result,
      title: `${result.recipe.channel} · ${result.recipe.start.slice(0, 10)} · ${result.recipe.roi.kind}`,
      saved_at: new Date().toISOString(),
    }),
  );
}
export async function readSaved(): Promise<Saved[]> {
  const results = await transaction<Job[]>(false, (s) => s.getAll());
  return results
    .map((r) => ({
      id: r.id,
      title: r.title || 'Analysis',
      saved_at: r.saved_at!,
      recipe: r.recipe,
    }))
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}
export async function loadSaved(id: string): Promise<Job> {
  const result = await transaction<Job | undefined>(false, (s) => s.get(id));
  if (!result) throw new Error('Saved analysis was not found in this browser.');
  return result;
}
export function exportAnalysis(result: Job, format: 'csv' | 'json') {
  const name = `carruthers-${result.recipe.channel}-${result.recipe.start.slice(0, 10)}${result.recipe.roi.kind === 'paired_sectors' ? '-dawn-dusk' : ''}`;
  if (format === 'json')
    return downloadText(
      `${name}.json`,
      JSON.stringify(result, null, 2),
      'application/json',
    );
  downloadText(`${name}.csv`, analysisCSV(result), 'text/csv;charset=utf-8');
}
