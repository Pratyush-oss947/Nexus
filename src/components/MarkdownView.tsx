import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface MarkdownViewProps {
  content: string;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyCode = (codeText: string, index: number) => {
    navigator.clipboard.writeText(codeText);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Split content by code fences (```lang ... ```)
  const parts: Array<{ type: 'text' | 'code'; lang?: string; content: string }> = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: content.substring(lastIndex, match.index),
      });
    }
    parts.push({
      type: 'code',
      lang: match[1] || 'code',
      content: match[2].trimEnd(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({
      type: 'text',
      content: content.substring(lastIndex),
    });
  }

  // Helper to format inline markdown (bold, inline code, italics)
  const renderInlineFormatted = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, lineIdx) => {
      // Check for bullet list
      const isBullet = line.trimStart().startsWith('* ') || line.trimStart().startsWith('- ');
      const cleanLine = isBullet ? line.trimStart().substring(2) : line;

      // Tokenize inline code `code` and bold **bold**
      const tokens: React.ReactNode[] = [];
      const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
      let lastInlineIdx = 0;
      let inlineMatch;

      while ((inlineMatch = inlineRegex.exec(cleanLine)) !== null) {
        if (inlineMatch.index > lastInlineIdx) {
          tokens.push(cleanLine.substring(lastInlineIdx, inlineMatch.index));
        }
        const token = inlineMatch[0];
        if (token.startsWith('`') && token.endsWith('`')) {
          tokens.push(
            <code
              key={`c-${inlineMatch.index}`}
              className="px-1.5 py-0.5 rounded bg-background-tertiary border border-border-subtle font-mono text-[11px] text-blue-300"
            >
              {token.slice(1, -1)}
            </code>
          );
        } else if (token.startsWith('**') && token.endsWith('**')) {
          tokens.push(
            <strong key={`b-${inlineMatch.index}`} className="font-semibold text-text-primary">
              {token.slice(2, -2)}
            </strong>
          );
        } else if (token.startsWith('*') && token.endsWith('*')) {
          tokens.push(
            <em key={`i-${inlineMatch.index}`} className="italic text-text-secondary">
              {token.slice(1, -1)}
            </em>
          );
        }
        lastInlineIdx = inlineMatch.index + token.length;
      }

      if (lastInlineIdx < cleanLine.length) {
        tokens.push(cleanLine.substring(lastInlineIdx));
      }

      if (isBullet) {
        return (
          <div key={lineIdx} className="flex items-start gap-2 my-1 pl-2">
            <span className="text-blue-400 mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0 inline-block"></span>
            <span className="flex-1">{tokens}</span>
          </div>
        );
      }

      if (!line.trim()) {
        return <div key={lineIdx} className="h-2"></div>;
      }

      return (
        <p key={lineIdx} className="my-1 leading-relaxed">
          {tokens}
        </p>
      );
    });
  };

  return (
    <div className="space-y-3 text-xs leading-relaxed select-text">
      {parts.map((part, idx) => {
        if (part.type === 'code') {
          const isCopied = copiedIndex === idx;
          return (
            <div
              key={idx}
              className="my-3 rounded-xl overflow-hidden border border-border-subtle bg-background-tertiary/90 shadow-sm"
            >
              {/* Code block header */}
              <div className="flex items-center justify-between px-3.5 py-1.5 bg-background-elevated/80 border-b border-border-subtle text-[11px] text-text-dim">
                <span className="font-mono text-[10px] text-text-muted uppercase tracking-wider">
                  {part.lang}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyCode(part.content, idx)}
                  className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors focus:outline-none"
                  aria-label="Copy code block"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400 font-medium">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Code content */}
              <div className="p-3.5 overflow-x-auto font-mono text-[11px] text-text-primary leading-relaxed">
                <pre>
                  <code>{part.content}</code>
                </pre>
              </div>
            </div>
          );
        }

        return <div key={idx}>{renderInlineFormatted(part.content)}</div>;
      })}
    </div>
  );
};
