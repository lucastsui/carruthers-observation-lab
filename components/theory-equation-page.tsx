'use client';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function TheoryEquationPage({ markdown }: { markdown: string }) {
  return <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{
    span: ({ node: _node, className, ...props }) => className === 'katex-display'
      // A focusable scroll region lets keyboard users read wide equations.
      // Keep KaTeX's span valid inside Markdown paragraphs.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role
      ? <span className={className} tabIndex={0} role="region" aria-label="Equation" {...props} />
      : <span className={className} {...props} />,
  }}>{markdown}</Markdown>;
}
