"use client";

import React from "react";
import { X, FileText } from "lucide-react";
import { markdownToHtml } from "@/lib/comfyui/markdown";
import {
  normalizeMarkdown,
  buildOutline,
  getLineStart,
  getLineEnd,
} from "./script-markdown-utils";
import { EditorToolbar, OutlineSidebar, EditorBody } from "./ScriptMarkdownEditor.parts";

interface ScriptMarkdownEditorProps {
  title?: string;
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
}

interface HistoryFrame {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const MAX_HISTORY = 50;

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
  // 记录编辑器最近一次自己发出的内容,用于区分「外部赋值(导入/回填)」与「内部编辑」。
  const lastEmittedRef = React.useRef<string | null>(null);
  // 归一化后的新历史基线:effect 中不直接 setState(react-hooks/set-state-in-effect),
  // 延迟到下一次 pushHistory(事件处理器)时替换历史基帧。
  const pendingHistoryBaseRef = React.useRef<string | null>(null);

  const emitChange = React.useCallback(
    (nextValue: string) => {
      lastEmittedRef.current = nextValue;
      onChange(nextValue);
    },
    [onChange],
  );

  // 外部内容入口:导入/回填的 markdown 先归一化再进入编辑器(折叠异常空行、
  // 去行尾空白等,见 normalizeMarkdown)。编辑器内部编辑不经此路径,避免干扰
  // 用户输入(如行尾补空格)。lastEmittedRef 相等说明是编辑器自己发出的内容。
  React.useEffect(() => {
    if (value === lastEmittedRef.current) return;
    const normalized = normalizeMarkdown(value);
    lastEmittedRef.current = normalized;
    if (normalized === value) return;
    pendingHistoryBaseRef.current = normalized;
    emitChange(normalized);
  }, [value, emitChange]);

  const outline = React.useMemo(() => buildOutline(value), [value]);
  const previewHtml = React.useMemo(() => markdownToHtml(value), [value]);

  function pushHistory(nextValue: string, start: number, end: number) {
    if (historyLockRef.current) return;
    const pendingBase = pendingHistoryBaseRef.current;
    if (pendingBase !== null) {
      // 外部内容刚被归一化:用归一化文本替换撤销历史基帧,避免 Ctrl+Z
      // 退回归一化前带异常空行的原始内容。
      pendingHistoryBaseRef.current = null;
      setHistory([
        {
          value: pendingBase,
          selectionStart: pendingBase.length,
          selectionEnd: pendingBase.length,
        },
        { value: nextValue, selectionStart: start, selectionEnd: end },
      ]);
      setHistoryIndex(1);
      return;
    }
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
      emitChange(frame.value);
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
    [history, historyIndex, emitChange],
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
    emitChange(nextValue);
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
    emitChange(nextValue);
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
    emitChange(nextValue);
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
    // 预览态下点击目录:先切回编辑态,再定位到对应行。
    setShowPreview(false);
    const lines = value.split("\n");
    let position = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      position += lines[i]!.length + 1;
    }
    emitChange(value); // ensure focus sync
    setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
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
      <EditorToolbar
        insertAtLineStart={insertAtLineStart}
        wrapSelection={wrapSelection}
        insertList={insertList}
        insertLink={insertLink}
        insertImage={insertImage}
        insertTable={insertTable}
        restoreHistory={restoreHistory}
        showPreview={showPreview}
        onTogglePreview={() => setShowPreview((prev) => !prev)}
      />

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Outline sidebar */}
        <OutlineSidebar outline={outline} onJump={jumpToLine} />

        {/* Editor area:单列布局 —— 编辑态直接显示 markdown 源(全宽),
            右上「预览」按钮按需切换到整区渲染视图,再点返回编辑。 */}
        <EditorBody
          textareaRef={textareaRef}
          value={value}
          showPreview={showPreview}
          previewHtml={previewHtml}
          emitChange={emitChange}
          pushHistory={pushHistory}
          getSelection={getSelection}
          onChange={(next, start, end) => {
            emitChange(next);
            selectionRef.current = { start, end };
            pushHistory(next, start, end);
          }}
        />
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
