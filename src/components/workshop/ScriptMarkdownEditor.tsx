"use client";

import React from "react";
import {
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
  Link,
  Image as ImageIcon,
  Table,
  Undo,
  Redo,
  Eye,
  EyeOff,
  X,
  FileText,
} from "lucide-react";
import { markdownToHtml } from "@/lib/comfyui/markdown";

interface ScriptMarkdownEditorProps {
  title?: string;
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
}

interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

interface HistoryFrame {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const MAX_HISTORY = 50;

function buildOutline(value: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = value.split("\n");
  lines.forEach((line, index) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      items.push({
        level: match[1]!.length,
        text: match[2]!.trim(),
        line: index,
      });
    }
  });
  return items;
}

function getLineStart(value: string, position: number): number {
  return value.lastIndexOf("\n", position - 1) + 1;
}

function getLineEnd(value: string, position: number): number {
  const nextBreak = value.indexOf("\n", position);
  return nextBreak === -1 ? value.length : nextBreak;
}

export function ScriptMarkdownEditor({
  title = "编辑剧本",
  value,
  onChange,
  onSave,
  onCancel,
}: ScriptMarkdownEditorProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = React.useState(false);
  const [history, setHistory] = React.useState<HistoryFrame[]>([
    { value, selectionStart: value.length, selectionEnd: value.length },
  ]);
  const [historyIndex, setHistoryIndex] = React.useState(0);
  const historyLockRef = React.useRef(false);
  const selectionRef = React.useRef({ start: value.length, end: value.length });

  const outline = React.useMemo(() => buildOutline(value), [value]);
  const previewHtml = React.useMemo(() => markdownToHtml(value), [value]);

  function pushHistory(nextValue: string, start: number, end: number) {
    if (historyLockRef.current) return;
    setHistory((prev) => {
      const sliced = prev.slice(0, historyIndex + 1);
      const next = [
        ...sliced,
        { value: nextValue, selectionStart: start, selectionEnd: end },
      ];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setHistoryIndex((idx) => Math.min(idx + 1, MAX_HISTORY - 1));
  }

  const restoreHistory = React.useCallback(
    (delta: number) => {
      const nextIndex = historyIndex + delta;
      if (nextIndex < 0 || nextIndex >= history.length) return;
      const frame = history[nextIndex];
      if (!frame) return;
      historyLockRef.current = true;
      onChange(frame.value);
      setHistoryIndex(nextIndex);
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(frame.selectionStart, frame.selectionEnd);
        }
        historyLockRef.current = false;
      }, 0);
    },
    [history, historyIndex, onChange],
  );

  function getSelection(): { start: number; end: number; text: string } {
    const el = textareaRef.current;
    if (!el) return { start: value.length, end: value.length, text: "" };
    return {
      start: el.selectionStart,
      end: el.selectionEnd,
      text: value.slice(el.selectionStart, el.selectionEnd),
    };
  }

  function replaceSelection(
    replacement: string,
    cursorOffset?: number,
    selectionLength?: number,
  ) {
    const el = textareaRef.current;
    if (!el) return;
    const { start, end } = getSelection();
    const nextValue = value.slice(0, start) + replacement + value.slice(end);
    const nextStart = start + (cursorOffset ?? replacement.length);
    const nextEnd =
      selectionLength === undefined ? nextStart : nextStart + selectionLength;
    onChange(nextValue);
    pushHistory(nextValue, nextStart, nextEnd);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(nextStart, nextEnd);
    }, 0);
  }

  function wrapSelection(before: string, after: string, placeholder = "文本") {
    const { text } = getSelection();
    const wrapped = text || placeholder;
    replaceSelection(
      `${before}${wrapped}${after}`,
      before.length,
      wrapped.length,
    );
  }

  function insertAtLineStart(prefix: string) {
    const el = textareaRef.current;
    if (!el) return;
    const { start, end } = getSelection();
    const lineStart = getLineStart(value, start);
    const lineEnd = getLineEnd(value, end);
    const selectedLines = value.slice(lineStart, lineEnd);
    const lines = selectedLines.split("\n");
    const transformed = lines
      .map((line) => {
        const trimmed = line.trimStart();
        const existing = /^#{1,3}\s/.test(trimmed);
        if (prefix.startsWith("#")) {
          if (existing) {
            return prefix + " " + trimmed.replace(/^#{1,3}\s*/, "");
          }
          return prefix + " " + trimmed;
        }
        return prefix + " " + trimmed;
      })
      .join("\n");
    const nextValue =
      value.slice(0, lineStart) + transformed + value.slice(lineEnd);
    const nextStart = lineStart;
    const nextEnd = lineStart + transformed.length;
    onChange(nextValue);
    pushHistory(nextValue, nextStart, nextEnd);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(nextStart, nextEnd);
    }, 0);
  }

  function insertList(ordered: boolean) {
    const el = textareaRef.current;
    if (!el) return;
    const { start, end } = getSelection();
    const lineStart = getLineStart(value, start);
    const lineEnd = getLineEnd(value, end);
    const selectedLines = value.slice(lineStart, lineEnd);
    const lines = selectedLines.split("\n");
    const transformed = lines
      .map((line, index) => {
        const marker = ordered ? `${index + 1}.` : "-";
        return `${marker} ${line.replace(/^(\d+\.|-)\s+/, "")}`;
      })
      .join("\n");
    const nextValue =
      value.slice(0, lineStart) + transformed + value.slice(lineEnd);
    onChange(nextValue);
    pushHistory(nextValue, lineStart, lineStart + transformed.length);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + transformed.length);
    }, 0);
  }

  function insertTable() {
    const sample =
      "| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |";
    replaceSelection(`\n${sample}\n`, 1, sample.length);
  }

  function insertLink() {
    wrapSelection("[", "](https://example.com)", "链接文本");
  }

  function insertImage() {
    wrapSelection("![", "](https://example.com/image.png)", "图片描述");
  }

  function jumpToLine(line: number) {
    const el = textareaRef.current;
    if (!el) return;
    const lines = value.split("\n");
    let position = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      position += lines[i]!.length + 1;
    }
    onChange(value); // ensure focus sync
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(position, position);
      const lineHeight = el.scrollHeight / lines.length;
      el.scrollTo({
        top: Math.max(0, line * lineHeight - el.clientHeight / 2),
        behavior: "smooth",
      });
    }, 0);
  }

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave?.();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        restoreHistory(event.shiftKey ? 1 : -1);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onSave, restoreHistory]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0f]">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-[#26262e] px-5">
        <div className="flex items-center gap-3">
          <span className="bg-primary/15 text-primary grid h-8 w-8 place-items-center rounded-lg">
            <FileText size={16} />
          </span>
          <h2 className="text-[15px] font-semibold text-[#ededf2]">{title}</h2>
        </div>
        <button
          onClick={onCancel}
          className="grid h-8 w-8 place-items-center rounded-lg text-[#9a9aad] transition-colors hover:bg-white/5 hover:text-[#ededf2]"
          aria-label="关闭"
        >
          <X size={18} />
        </button>
      </header>

      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-[#26262e] bg-[#0f0f14] px-4 py-2">
        <ToolbarGroup>
          <ToolbarButton onClick={() => insertAtLineStart("#")} title="标题 1">
            <Heading1 size={18} />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertAtLineStart("##")} title="标题 2">
            <Heading2 size={18} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => insertAtLineStart("###")}
            title="标题 3"
          >
            <Heading3 size={18} />
          </ToolbarButton>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <ToolbarButton
            onClick={() => wrapSelection("**", "**", "粗体")}
            title="粗体"
          >
            <Bold size={18} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => wrapSelection("*", "*", "斜体")}
            title="斜体"
          >
            <Italic size={18} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => wrapSelection("__", "__", "下划线")}
            title="下划线"
          >
            <Underline size={18} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => wrapSelection("~~", "~~", "删除线")}
            title="删除线"
          >
            <Strikethrough size={18} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => wrapSelection("`", "`", "代码")}
            title="行内代码"
          >
            <Code size={18} />
          </ToolbarButton>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <ToolbarButton onClick={() => insertList(false)} title="无序列表">
            <List size={18} />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertList(true)} title="有序列表">
            <ListOrdered size={18} />
          </ToolbarButton>
          <ToolbarButton onClick={() => insertAtLineStart(">")} title="引用">
            <Quote size={18} />
          </ToolbarButton>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <ToolbarButton onClick={insertLink} title="链接">
            <Link size={18} />
          </ToolbarButton>
          <ToolbarButton onClick={insertImage} title="图片">
            <ImageIcon size={18} />
          </ToolbarButton>
          <ToolbarButton onClick={insertTable} title="表格">
            <Table size={18} />
          </ToolbarButton>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <ToolbarButton
            onClick={() => restoreHistory(-1)}
            title="撤销 (Ctrl+Z)"
          >
            <Undo size={18} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => restoreHistory(1)}
            title="重做 (Ctrl+Shift+Z)"
          >
            <Redo size={18} />
          </ToolbarButton>
        </ToolbarGroup>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowPreview((prev) => !prev)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#9a9aad] transition-colors hover:bg-white/5 hover:text-[#ededf2]"
          >
            {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            {showPreview ? "隐藏预览" : "预览"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Outline sidebar */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-[#26262e] bg-[#0f0f14] p-4">
          <h3 className="mb-3 text-xs font-semibold tracking-wider text-[#6b7088] uppercase">
            目录大纲
          </h3>
          {outline.length === 0 ? (
            <p className="text-xs leading-relaxed text-[#5a5f73]">
              使用 # / ## / ### 添加标题后，此处自动生成目录。
            </p>
          ) : (
            <nav className="space-y-1">
              {outline.map((item, index) => (
                <button
                  key={`${item.line}-${index}`}
                  onClick={() => jumpToLine(item.line)}
                  className={`block w-full truncate rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-white/5 hover:text-[#ededf2] ${
                    item.level === 1
                      ? "font-medium text-[#c9c9d6]"
                      : item.level === 2
                        ? "pl-5 text-[#9a9aad]"
                        : "pl-8 text-[#8b90a8]"
                  }`}
                  title={item.text}
                >
                  {item.text}
                </button>
              ))}
            </nav>
          )}
        </aside>

        {/* Editor area */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange(nextValue);
                selectionRef.current = {
                  start: event.target.selectionStart,
                  end: event.target.selectionEnd,
                };
                pushHistory(
                  nextValue,
                  event.target.selectionStart,
                  event.target.selectionEnd,
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Tab") {
                  event.preventDefault();
                  const { start, end } = getSelection();
                  const nextValue =
                    value.slice(0, start) + "  " + value.slice(end);
                  onChange(nextValue);
                  pushHistory(nextValue, start + 2, start + 2);
                  setTimeout(
                    () =>
                      textareaRef.current?.setSelectionRange(
                        start + 2,
                        start + 2,
                      ),
                    0,
                  );
                }
              }}
              spellCheck={false}
              placeholder="# 剧本标题\n\n## 第一场\n\n（在此处编写完整剧本……）"
              className={`flex-1 resize-none bg-[#0a0a0f] p-6 font-mono text-[13px] leading-7 text-[#e5e7eb] outline-none placeholder:text-[#5a5a6b] ${
                showPreview ? "border-r border-[#26262e]" : ""
              }`}
              style={{ tabSize: 2 }}
            />
            {showPreview && (
              <div
                className="flex-1 overflow-y-auto bg-[#0a0a0f] p-6 text-[13px] leading-7 text-[#d4d4d8]"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="flex h-16 items-center justify-end gap-3 border-t border-[#26262e] bg-[#0f0f14] px-6">
        <span className="mr-auto text-xs text-[#6b7088]">
          {value.split("\n").filter((line) => line.trim()).length} 行 ·{" "}
          {value.trim().length} 字符
        </span>
        <button
          onClick={onCancel}
          className="rounded-lg border border-[#26262e] bg-transparent px-5 py-2 text-xs font-medium text-[#c9c9d6] transition-colors hover:bg-white/5"
        >
          取消
        </button>
        <button
          onClick={onSave}
          className="btn-gradient rounded-lg px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-purple-900/20"
        >
          保存
        </button>
      </footer>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="grid h-8 w-8 place-items-center rounded-lg text-[#9a9aad] transition-colors hover:bg-white/5 hover:text-[#ededf2]"
    >
      {children}
    </button>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function ToolbarDivider() {
  return <div className="mx-2 h-5 w-px bg-[#26262e]" />;
}
