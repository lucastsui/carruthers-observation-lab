import context from '../content/theory-context.md?raw';

// Keep the scientific explanation editable as Markdown, with one page per section.
export const THEORY_CONTEXT_SECTIONS = context.trim().split(/^### /m).filter(Boolean).map(section => {
  const newline = section.indexOf('\n');
  return { title: section.slice(0, newline), markdown: section.slice(newline + 1).trim() };
});
