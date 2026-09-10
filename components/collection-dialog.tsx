'use client';
import { useState } from 'react';
import { FolderOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Catalogue, Recipe } from '@/lib/research';
import type { useAnalysis } from '@/hooks/use-analysis';

export function CollectionDialog({
  catalogue,
  a,
  onRestore,
}: {
  catalogue: Catalogue;
  a: ReturnType<typeof useAnalysis>;
  onRestore: (r: Recipe) => void;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(a.saved.length / 4) - 1),
    current = Math.min(page, last);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="button ghost">
        <FolderOpen />
        Collection & saved
      </DialogTrigger>
      <DialogContent className="reference-dialog">
        <DialogTitle>Observation collection</DialogTitle>
        <DialogDescription>March 2026 · L1C v1.3</DialogDescription>
        <Tabs defaultValue="saved">
          <TabsList>
            <TabsTrigger value="saved">
              Saved analyses ({a.saved.length})
            </TabsTrigger>
            <TabsTrigger value="collection">Source data</TabsTrigger>
          </TabsList>
          <TabsContent value="saved">
            <div className="saved-list">
              {a.saved.length ? (
                a.saved.slice(current * 4, current * 4 + 4).map((s) => (
                  <div className="saved-item" key={s.id}>
                    <button
                      onClick={async () => {
                        const result = await a.load(s.id);
                        if (result) {
                          onRestore(result.recipe);
                          setOpen(false);
                        }
                      }}
                    >
                      {s.title}
                    </button>
                    <div className="small muted">
                      {s.recipe.frame_ids.length} frames · saved{' '}
                      {s.saved_at.slice(0, 10)}
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">
                  Select a region and run its time-series analysis,
                  then choose Save to keep its values and selection in this browser. Export a copy before the website address changes.
                </p>
              )}
            </div>
            {last > 0 && (
              <div className="saved-pagination">
                <button
                  className="button icon"
                  disabled={current === 0}
                  onClick={() => setPage(current - 1)}
                  aria-label="Previous saved analyses"
                >
                  <ChevronLeft />
                </button>
                <span>
                  {current + 1} / {last + 1}
                </span>
                <button
                  className="button icon"
                  disabled={current === last}
                  onClick={() => setPage(current + 1)}
                  aria-label="Next saved analyses"
                >
                  <ChevronRight />
                </button>
              </div>
            )}
          </TabsContent>
          <TabsContent value="collection">
            <p>
              {catalogue.frames.length.toLocaleString()} frames ·{' '}
              {catalogue.file_count} files ·{' '}
              {(catalogue.bytes / 1024 ** 3).toFixed(1)} GiB
            </p>
            <p className="muted">
              The app reads individual frames from the observation files on the research server.
              Saved analyses contain measured values and the recipe used to
              extract them.
            </p>
            {catalogue.skipped.length > 0 && (
              <p className="status">
                {catalogue.skipped.length} files outside the validated March
                v1.3 collection were skipped.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
