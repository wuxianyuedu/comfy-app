import type { Meta, StoryObj } from "@storybook/nextjs";

import { CodeBlock, extToLanguage } from "~/components/ui/code-block";

/**
 * `CodeBlock` 是 shiki（VSCode 同款高亮引擎）驱动的源码展示块。
 *
 * 两处值得单独说：
 *
 * 1. **`language` 是显式 prop，不由组件猜**。调用处一般从文件路径派生，
 *    而「按扩展名 → 高亮语言」这张表**只有一处**：导出的 `extToLanguage()`。
 *    本件的 story 因此把它一并覆盖 —— 五档并排才看得出「哪一档没配上」
 *    （未知扩展名落 `plaintext`）。
 * 2. **首帧先渲染纯文本行号，再整体换成高亮**：按 `CHUNK_LINES` 分片高亮、
 *    片间让出主线程；超过 `MAX_HIGHLIGHT_CHARS` 时**整块走纯文本**，
 *    宁可不高亮也不卡住主线程。所以打开瞬间没高亮是**分片的表现**、不是闪烁。
 *    行号本身改用 `codeToTokensBase` 的结构化 token 由 React 渲染
 *    （不再正则注入 shiki 的 HTML），因此每行左边必有一个数字。
 *
 * 高亮主题跟应用主题走（`resolvedTheme`：light → `github-light`，
 * 否则 `one-dark-pro`）—— 用工具栏切明暗，代码块的底色与 token 色应一起换。
 */
const meta = {
  title: "UI/CodeBlock",
  component: CodeBlock,
  args: { code: "", language: "typescript" },
} satisfies Meta<typeof CodeBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

/* 样本源码刻意**照本仓的写法**给：数字按精度成串走 `~/lib/number-format` 的
   `fixed`，不是裸 `.toFixed(2)`（规范 16 §16.2.4.54 的 P50 硬闸 —— 这条闸
   连 story 里的**示例代码字符串**也数，本批第一版就是这么被拦下的）。
   把它照实写成仓里的写法，读的人抄走的那份才是对的。 */
const SAMPLE_TS = `import { fixed } from "~/lib/number-format";

type Probe = { id: string; value: number };

export function summarize(probes: readonly Probe[]): string {
  const total = probes.reduce((sum, probe) => sum + probe.value, 0);
  return probes.length === 0 ? "—" : (fixed(total / probes.length, 2) ?? "—");
}
`;

/** 最常用：一份 TypeScript 源文件。 */
export const Default: Story = {
  args: { code: SAMPLE_TS, language: "typescript" },
  render: (args) => <div className="w-160">{<CodeBlock {...args} />}</div>,
};

/** 行号：这条 story 的判据很直接 —— **每一行左边都有一个数字**。
 *  曾经走「正则注入 shiki 输出」时行号会整片消失。 */
export const LineNumbers: Story = {
  args: {
    code: Array.from(
      { length: 24 },
      (_, index) => `const line${String(index + 1)} = ${String(index + 1)};`,
    ).join("\n"),
    language: "typescript",
  },
  render: (args) => <div className="w-160">{<CodeBlock {...args} />}</div>,
};

/**
 * 各语言并列，且**展示 `extToLanguage()` 的判决** ——
 * 这正是调用处派生 `language` 的方式。最后一档是未知扩展名，
 * 应落 `plaintext`（不高亮，但仍带行号）。
 */
export const Languages: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {[
        ["workflow.json", '{ "3": { "class_type": "KSampler" } }'],
        ["styles.css", ".probe { color: var(--color-primary); }"],
        [
          "steps.yml",
          "steps:\n  - name: 解析\n    run: node scripts/parse.mjs",
        ],
        ["notes.md", "# 标题\n\n一段说明。"],
        ["unknown.zzz", "这一档没有对应的高亮语言，落 plaintext。"],
      ].map(([fileName, code]) => (
        <div key={fileName} className="flex flex-col gap-1.5">
          <span className="text-ink-muted font-mono text-[11px]">
            {fileName} → extToLanguage() = {extToLanguage(fileName ?? "")}
          </span>
          <div className="w-160">
            <CodeBlock
              code={code ?? ""}
              language={extToLanguage(fileName ?? "")}
            />
          </div>
        </div>
      ))}
    </div>
  ),
};

/** 超大文件：超过 `MAX_HIGHLIGHT_CHARS` 时**整块走纯文本行号渲染**
 *  —— 宁可不高亮，也不让主线程卡住（这是那条阈值的现场）。 */
export const OversizedFallsBackToPlain: Story = {
  args: {
    code: Array.from(
      { length: 400 },
      (_, index) =>
        `// 第 ${String(index + 1)} 行：一段足够长的注释，用来把字符数推过阈值`,
    ).join("\n"),
    language: "typescript",
  },
  render: (args) => <div className="w-160">{<CodeBlock {...args} />}</div>,
};

/** 空代码：`code` 是空串时两段 Span 都不渲染 —— 它是「文件还没选」的形态，
 *  不该看起来像加载中。 */
export const Empty: Story = {
  args: { code: "", language: "plaintext" },
  render: (args) => <div className="w-160">{<CodeBlock {...args} />}</div>,
};
