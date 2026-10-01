// ── 应用内控制台的**命令目录**（纯叶子：零 IO、零 React、零 server-only）─────
//
// 用户侧诉求（ISSUE #1327）：界面上做个控制台，能直接跑那些「本来要另开一个
// 终端窗口敲」的操作 —— 跑一遍质量门禁、推一次 schema、查一段 git 历史……
// 于是这里回答两个问题，且**只回答这两个**：
//   1. 有哪些预设命令（`CONSOLE_PRESETS`）——分组、标签、argv、说明；
//   2. 用户敲的那一行**合不合法**（`parseConsoleLine`）。
//
// 为什么是「预设 + 自由行」而不是「只放几个按钮」：真去开终端的人要的正是
// 临时拼一条命令（`git log --oneline -20`、`pnpm exec vitest run <文件>`），
// 只给按钮等于把「开终端」换成「去改代码加按钮」。所以自由行是主线，
// 预设是它的**快捷方式**（点一下把命令填进输入框，而不是绕开输入框直接跑）。
//
// 安全边界见 `console-command.ts` 的文件头：**这条链能执行任意本机命令，
// 因此它的守卫是「谁能到达这个路由」而不是「命令里有没有某个词」**。
// 本模块刻意不做「危险命令黑名单」—— 那种黑名单既拦不住 `node -e "..."`，
// 又会让用户以为它拦得住（同 §12.18 的判断反模式：会静默失效的清单）。

/** 预设命令的一个分组（界面上按组分块展示）。 */
export interface ConsolePresetGroup {
  /** 分组机器名（也是 React key）。 */
  id: string;
  /** 分组标题。 */
  label: string;
  /** 一句话说明这一组是干什么的（分组标题下方的灰字）。 */
  hint: string;
  items: ConsolePreset[];
}

/** 一条预设命令。 */
export interface ConsolePreset {
  /** 预设机器名（界面上「填入」按钮的 key）。 */
  id: string;
  /** 展示名。 */
  label: string;
  /** 要填进输入框的完整命令行（**就是**用户会敲的那行文本）。 */
  command: string;
  /** 这条命令做什么、什么时候用它。 */
  desc: string;
}

/**
 * 预设命令表。
 *
 * 口径：只列**这个仓库里真实存在**的入口（`package.json` 的 scripts 或
 * `scripts/*.mjs`），不列「你应该装个 xxx 然后用」——预设是快捷方式，
 * 不是教程。命令一律写成 `pnpm exec` / `node` 的显式形态，与 AGENTS 硬规则 1
 * 同源（本项目禁止 npx / npm run：npm 11.19 解析 typescript 别名链会崩）。
 */
export const CONSOLE_PRESETS: ConsolePresetGroup[] = [
  {
    id: "quality",
    label: "质量门禁",
    hint: "提交前自查；与 .githooks/pre-commit 同一套判据来源",
    items: [
      {
        id: "typecheck",
        label: "类型检查",
        command: "pnpm exec tsc --noEmit",
        desc: "全仓类型检查（与 pre-commit 组 A 同一条命令）",
      },
      {
        id: "lint",
        label: "Lint",
        command: "pnpm run lint",
        desc: "eslint 零警告口径，扫描范围见 package.json 的 lint 脚本",
      },
      {
        id: "test",
        label: "全部测试",
        command: "pnpm test",
        desc: "vitest 全量（按 vitest.config.ts 的预算并发）",
      },
      {
        id: "test-coverage",
        label: "覆盖率",
        command: "pnpm test:coverage",
        desc: "全量测试 + 覆盖率报告（各子域门槛见规范 §18.6）",
      },
      {
        id: "check-all",
        label: "一键质量门禁",
        command: "pnpm check:all",
        desc: "scripts/quality-gate.mjs：本地跑一遍完整门禁",
      },
      {
        id: "format-check",
        label: "格式检查",
        command: "pnpm run format:check",
        desc: "prettier 检查（不改文件）",
      },
    ],
  },
  {
    id: "db",
    label: "数据库",
    hint: "SQLite schema 的生成与应用；改完 schema.ts 走这里",
    items: [
      {
        id: "db-generate",
        label: "生成迁移",
        command: "pnpm db:generate",
        desc: "drizzle-kit generate：按 schema.ts 产出迁移文件",
      },
      {
        id: "db-push",
        label: "应用 schema",
        command: "pnpm db:push",
        desc: "把 schema 推到本地库（走 scripts/db-push.mjs 的共享内核）",
      },
      {
        id: "db-studio",
        label: "Drizzle Studio",
        command: "pnpm db:studio",
        desc: "起 Drizzle Studio 看库；注意它在跑期间不要 pnpm install",
      },
    ],
  },
  {
    id: "dev",
    label: "启动与端口",
    hint: "工具链与启动前置，都是只读或幂等的",
    items: [
      {
        id: "toolchain",
        label: "工具链自查",
        command: "pnpm run check:toolchain",
        desc: "corepack / pnpm 三形态探测（起不来时先跑它）",
      },
      {
        id: "env-init",
        label: "初始化 .env",
        command: "pnpm run env:init",
        desc: "按 .env.example 生成 .env（缺三项非空时会挡在启动前）",
      },
    ],
  },
  {
    id: "git",
    label: "版本库",
    hint: "只读的历史与状态查询；写操作请走 PR 流程（规范 §13.6）",
    items: [
      {
        id: "git-status",
        label: "工作区状态",
        command: "git status -sb",
        desc: "当前分支、改动与未跟踪文件",
      },
      {
        id: "git-log",
        label: "最近提交",
        command: "git log --oneline -20",
        desc: "最近 20 条提交（一行一条）",
      },
      {
        id: "git-branch",
        label: "本地分支",
        command: "git branch -vv",
        desc: "本地分支及其上游跟踪关系",
      },
      {
        id: "git-diff-stat",
        label: "改动统计",
        command: "git diff --stat",
        desc: "未暂存改动的文件与行数统计",
      },
      {
        id: "git-remote",
        label: "远端配置",
        command: "git remote -v",
        desc: "远端仓库地址（提 PR / 查上游时用）",
      },
    ],
  },
  {
    id: "diag",
    label: "诊断",
    hint: "出问题时先看这些；日志实际落在 log/ 的哪个分区见规范 launch-and-build §4",
    items: [
      {
        id: "port-vectors",
        label: "端口推导自检",
        command: "node scripts/check-app-port-vectors.cjs",
        desc: "四语言（Node / PowerShell / Python / Rust）读同一份校验向量，任一侧漂移即报错",
      },
      {
        id: "node-version",
        label: "Node 版本",
        command: "node -v",
        desc: "当前 Node 版本（pnpm 版本看「工具链自查」）",
      },
    ],
  },
];

/** 全部预设的展平表（按 id 取值用）。 */
export function allPresets(): ConsolePreset[] {
  return CONSOLE_PRESETS.flatMap((group) => group.items);
}

/**
 * 这一行里出现了**会被误当成 shell 语法**的东西 —— 给出一条用户看得懂的提示。
 *
 * 为什么需要它：解析器不解释 `;` `|` `>` `&` `$(…)` `%VAR%`（见 `parseConsoleLine`
 * 的文件头），于是 `node -v && pnpm -v` 会变成「`node` 带上 `-v` `&&` `pnpm` `-v`
 * 四个参数」。**实测** `node` 会静默忽略多余参数、以退出码 0 结束 —— 界面上看起来
 * 一切正常，而用户以为跑过了两条命令。这是最坏的一种「看着对、其实不是你要的」，
 * 所以要在提交前说出来，而不是等他自己发现结果不对。
 *
 * 判据是**提示**不是拒绝：这些字符在某些命令里是合法实参
 * （`echo "a|b"`、`git log --format=%H`），拒绝会连带挡掉正当用法；
 * 「提醒一句」的成本远低于「排查为什么只跑了一半」。
 *
 * 返回 null 表示没看到可疑形态。返回值里带上**命中的具体片段** ——
 * 一句泛泛的「含有特殊字符」用户不知道该改哪里。
 */
export function shellSyntaxWarning(line: string): string | null {
  const raw = (line ?? "").trim();
  if (!raw) return null;
  /** 命中片段（去重、保持首次出现顺序，便于文案里逐个点名）。 */
  const found: string[] = [];
  const hit = (fragment: string) => {
    if (!found.includes(fragment)) found.push(fragment);
  };
  /* 逐字符扫一遍：每个控制符只需判一次，比叠一串互相干扰的正则好读也好测。
   * 引号**不参与**这里的判断 —— `echo "a|b"` 里的 `|` 确实是普通字符，
   * 而本函数是「提醒」不是「拒绝」，多提醒一句的代价远低于漏提醒。 */
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === ";") hit(";");
    else if (ch === "|") hit("|");
    else if (ch === ">") hit(">");
    else if (ch === "<") hit("<");
    else if (ch === "&") hit("&");
    else if (ch === "`") hit("`…`（命令替换）");
    else if (ch === "$" && (raw[i + 1] === "(" || raw[i + 1] === "{"))
      hit("$(…) / ${…}（变量展开）");
  }
  /* Windows 形态的 `%VAR%`：必须成对出现才算（`git log --format=%H` 的单个
   * `%H` 不是变量展开，不该被点名）。 */
  if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(raw)) hit("%VAR%");
  if (found.length === 0) return null;
  return (
    `这行里有 ${found.join("、")} —— 控制台**不经过 shell**，它们会被当成普通参数` +
    `（例如 \`a && b\` 只会执行 a，退出码还可能是 0）。要串联多条命令请写进一个小脚本。`
  );
}

/** 一次「命令行 → 待执行计划」的解析结果。 */
export type ParsedConsoleLine =
  | {
      ok: true;
      /** 交给 `spawn` 的可执行文件。 */
      file: string;
      /** 交给 `spawn` 的参数数组（逐项，**不经过 shell 二次解析**）。 */
      args: string[];
      /** 供界面回显与实际执行对齐的规范化命令行。 */
      display: string;
    }
  | { ok: false; reason: string };

/**
 * 把用户敲的一行拆成 `file + args`（**不走 shell**）。
 *
 * 为什么不用 `shell: true` / `cmd /c`：那等于让引号、通配符、`&&`、重定向、
 * 变量展开都交给平台的 shell 解析器，而两套解析器的规则不同（`cmd` 认 `%VAR%`、
 * `sh` 认 `$VAR`、`^` 转义只有 cmd 有）—— 同一行在 Windows 与 POSIX 上会跑出
 * 不同的东西，而界面只能有一份「回显的命令」。这里只认**空格分段的引号语法**
 * （单引号与双引号都支持，反斜杠转义引号），拼不出 `;` / `|` / `>` 这类
 * 控制符的语义 —— 要那类语义就写个小脚本（`node -e` / `scripts/*.mjs`），
 * 而不是在输入框里叠一层 shell。
 *
 * 判据表（也是单测夹具）：
 *   · `pnpm exec tsc --noEmit`      → file=pnpm, args=["exec","tsc","--noEmit"]
 *   · `echo "a b" 'c d'`            → file=echo, args=["a b","c d"]
 *   · `echo a\ b`                   → file=echo, args=["a b"]
 *   · `` (空 / 全空白)              → ok:false, reason=「命令为空」
 *   · `echo "未闭合`                → ok:false, reason=「引号未闭合」
 */
export function parseConsoleLine(line: string): ParsedConsoleLine {
  const raw = (line ?? "").trim();
  if (!raw) return { ok: false, reason: "命令为空" };

  const tokens: string[] = [];
  let current = "";
  /** 当前 token 是否已经「开过头」：空引号 `''` 也是一个合法空参数。 */
  let started = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] ?? "";
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (ch === "\\" && quote === '"' && raw[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    /* 转义只做一件有用的事：让空格（或引号）能出现在同一个参数里。
     * 先取出再判 `!== undefined`，而不是非空断言 —— 「末尾那个反斜杠后面
     * 什么都没有」是真实输入，此时它只是个普通字符，不该断言必然存在。 */
    const escaped = raw[i + 1];
    if (ch === "\\" && escaped !== undefined) {
      current += escaped;
      i++;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }

  if (quote) return { ok: false, reason: `引号未闭合（缺少配对的 ${quote}）` };
  if (started) tokens.push(current);
  if (tokens.length === 0) return { ok: false, reason: "命令为空" };

  const [file, ...args] = tokens as [string, ...string[]];
  return { ok: true, file, args, display: [file, ...args].join(" ") };
}
