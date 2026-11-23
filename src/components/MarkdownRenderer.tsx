import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { normalizeMathMarkdown } from "../utils/markdown";

interface MarkdownRendererProps {
  content: string;
}

function extractTextFromReactNode(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractTextFromReactNode).join("");
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractTextFromReactNode(node.props.children);
  }
  return "";
}

function isSafeHref(href?: string): boolean {
  if (!href) return false;
  const trimmed = href.trim().toLowerCase();
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:")
  );
}

function CodeBlock({
  children,
}: {
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const codeElement = React.Children.toArray(children).find((child) =>
    React.isValidElement(child)
  ) as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;

  const className = codeElement?.props?.className ?? "";
  const langMatch = /language-([a-zA-Z0-9_-]+)/.exec(className);
  const language = langMatch ? langMatch[1] : "text";
  const rawCode = extractTextFromReactNode(codeElement?.props?.children ?? children).replace(
    /\n$/,
    ""
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100/80 px-3.5 py-1.5">
        <span className="font-mono text-xs font-medium text-slate-600">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600"
          aria-label="코드 복사"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-emerald-700">복사됨</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>복사</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 text-[13px] leading-relaxed">{children}</pre>
    </div>
  );
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const normalized = useMemo(() => normalizeMathMarkdown(content), [content]);

  const components: Components = useMemo(
    () => ({
      pre({ children }) {
        return <CodeBlock>{children}</CodeBlock>;
      },
      a({ href, children }) {
        if (!isSafeHref(href)) {
          return <span className="text-slate-700 underline decoration-slate-300">{children}</span>;
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-800"
          >
            {children}
          </a>
        );
      },
      table({ children }) {
        return (
          <div className="my-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="!my-0">{children}</table>
          </div>
        );
      },
    }),
    []
  );

  return (
    <div className="tutor-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={components}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
};
