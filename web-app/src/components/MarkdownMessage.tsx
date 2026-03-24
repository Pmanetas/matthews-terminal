import { cn } from '@/lib/utils'

interface MarkdownMessageProps {
  text: string
  className?: string
}

export function MarkdownMessage({ text, className }: MarkdownMessageProps) {
  const blocks = parseBlocks(text)

  return (
    <div className={cn('space-y-3', className)}>
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return (
            <div key={i} className="rounded-lg overflow-hidden border border-white/[0.06]">
              {block.lang && (
                <div className="bg-white/[0.04] px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/30 border-b border-white/[0.06]">
                  {block.lang}
                </div>
              )}
              <pre className="bg-black/40 p-3 overflow-x-auto">
                <code className="text-[13px] leading-relaxed text-emerald-300/90 font-mono">
                  {block.content}
                </code>
              </pre>
            </div>
          )
        }

        // Regular text — render inline markdown
        return (
          <div
            key={i}
            className="text-sm leading-relaxed text-white/70"
            dangerouslySetInnerHTML={{ __html: renderInline(block.content) }}
          />
        )
      })}
    </div>
  )
}

interface Block {
  type: 'text' | 'code'
  content: string
  lang?: string
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index).trim()
      if (textBefore) blocks.push({ type: 'text', content: textBefore })
    }
    // Code block
    blocks.push({ type: 'code', content: match[2].trimEnd(), lang: match[1] || undefined })
    lastIndex = match.index + match[0].length
  }

  // Remaining text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim()
    if (remaining) blocks.push({ type: 'text', content: remaining })
  }

  if (blocks.length === 0) {
    blocks.push({ type: 'text', content: text })
  }

  return blocks
}

function renderInline(text: string): string {
  return text
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 rounded text-[13px] font-mono text-violet-300">$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white/90 font-semibold">$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Bullet lists
    .replace(/^[-•] (.+)$/gm, '<div class="flex gap-2 items-start"><span class="text-violet-400/60 mt-0.5">•</span><span>$1</span></div>')
    // Numbered lists
    .replace(/^(\d+)\. (.+)$/gm, '<div class="flex gap-2 items-start"><span class="text-violet-400/60 font-mono text-xs mt-0.5">$1.</span><span>$2</span></div>')
    // Line breaks
    .replace(/\n/g, '<br />')
}
