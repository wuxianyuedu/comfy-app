/**
 * 文档引用校验自检：锁住 scripts/check-doc-references.cjs（pnpm doc:check）的
 * 「单一事实 + 防裸值回潮」契约真的成立，而不是只写在文档里。
 *
 * 规范：docs/reference-facts.md（单一事实映射 + 维护规则）
 *   - placeholder 类（shell.* / 端口）：编辑态文档出现裸值即报错（防回潮）
 *   - verify 类（dev.*）：文档保留直观值，脚本核对权威源当前端口族
 *
 * 为什么覆盖「并行引用点」：同一份值出现在多篇文档、且原文形态不同时
 * （ComfyUI 端口在 workshop-mcp 里是无括号 `:8188`、在主规范「开发端口」行里是
 * `localhost:3100` / `:8188` 并列），主规范的引用点不会命中 `onlyDocs`。
 * 规则是**把引用点并进同一事实（otherDocs），而不是把它挪出校验范围**——
 * 挪出去等于放弃防回潮。这里用 FACTS 定义 + 文档原文双重断言锁住该行为。
 *
 * 为什么用子进程跑：该脚本被 `pnpm doc:check` 以 `node scripts/xxx.cjs` 调用，
 * 复用同一调用方式才等价于真实校验（脚本内部用 __dirname 定位仓库根）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { snapshotPaths } from "./helpers/probe-restore.ts";
import { createProbeTree } from "./helpers/probe-worktree.ts";

/** 真实仓库根 —— 只用来**核对它没被写过**，本文件一次都不往它上面写（ISSUE #2665）。 */
const REAL_ROOT = process.cwd();
/**
 * 探针用的那份一次性克隆（HEAD + 当前工作树里脏的那几份）。
 *
 * 为什么不是「每组探针一棵」：`git worktree add` 实测 4.81s（3156 份文件），本文件有十几组
 * 探针 —— 每组一棵会把这一段从秒级抬到分钟级，而它换来的隔离量是零（同一棵树里的两组
 * 探针本来就不并发，vitest 文件内是串行的）。**文件级一棵**就够了：要挡的是
 * **别的用例文件**在同一时刻读同一份文档。
 */
const PROBE = createProbeTree(REAL_ROOT);
/** 本文件的「仓库根」= 那份克隆：判据、渲染件、探针写盘全部落在它里面。 */
const REPO_ROOT = PROBE.dir;
const CHECK = join(REPO_ROOT, "scripts", "check-doc-references.cjs");

/** 「文档怎么引用门禁」那三条判据的分片（它们在 `check-doc-gate-refs.cjs`）。
 *
 *  为什么要分成两份读：那一半判的**不是**「硬编码值 / 路径 / 端口」，两半合住一份文件
 *  时越过了文件长度硬闸；而它的**接入点**仍在 `check-doc-references.cjs` 的 `main` 里。
 *  于是「函数定义在哪」与「有没有人调它」是两个文件、两条读法 —— 拿哪一份去找另一件
 *  都会落空，那是判据搬了家、不是判据没了。 */
function gateRefsSource(): string {
  return readFileSync(join(REPO_ROOT, "scripts", "check-doc-gate-refs.cjs"), "utf8");
}

/** 把脚本真正引入的内存态 FACTS 拿来做结构断言（与脚本同源，见 doc-facts.cjs）。 */
type Fact = {
  extract: () => unknown;
  key: string;
  kind: string;
  onlyDocs?: Array<string>;
  otherDocs?: Array<string>;
  placeholder?: string;
};

async function loadFacts(): Promise<Array<Fact>> {
  const mod =
    /* SAFETY: 类型断言已复核 */ (await import("../scripts/doc-facts.cjs")) as unknown as {
      FACTS: Array<Fact>;
    };
  return mod.FACTS;
}

function runCheck(): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [CHECK], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    /* SAFETY: 类型断言已复核 */
    const e = error as {
      status?: number;
      stderr?: string;
      stdout?: string;
    };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

const docText = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/* ── 探针收尾的最后一道网（ISSUE #2415 → #2593 订正 → #2665 换形）─────────
 * 本文件多数组的现场是「改一笔 → 判 → 收尾」。#2593 那一批把「收尾」从
 * `git checkout --`（那吃过两次未提交的文档改动）换成「进本文件那一刻的字节快照」；
 * #2665 这一批把**写的那一侧**整段搬进一次性克隆（`tests/helpers/probe-worktree.ts`），
 * 于是真实工作树不再被写、并发读者那道口子上不再有人往里丢探针文本。
 *
 * 因此这道网的语义**跟着换了**：它以前是「还原」，现在是「核对真实树没被动过」——
 * `PROBE_TARGETS` 这几份从模块加载到本文件跑完，字节必须与进来时逐字相同。
 * 红的意思是「有探针绕过了克隆去写真实树」（= 本件被写坏了，或有人新加了直写真实树的一组），
 * 不再是「工作区脏了」—— 后者可能是这条分支上正在做的活，不该由这一档判定。 */
const PROBE_TARGETS = [
  "AGENTS.md",
  "docs/reference-facts.md",
  "docs/standards/13-提交与-code-review.md",
  "docs/guides/DEV-QUERIES.md",
  "docs/generated/DEV-QUERIES.md",
  "docs/standards/99-temp-unregistered.md",
  "changelog.d/zz-step-index-probe.md",
];

/**
 * 快照取在**模块加载时**，且取的是**真实树**（`REAL_ROOT`，不是克隆）——
 * 比本文件任何一条 `it` 都早，所以「进本文件之前就脏的那份工作」会被原样当作基准；
 * 取晚了拍到的就是探针改过的那一版，核对于是把探针的脏固化成「原样」。
 */
const PRISTINE = snapshotPaths(PROBE_TARGETS.map((rel) => join(REAL_ROOT, rel)));

afterEach(() => {
  const touched: Array<string> = [];
  for (const [abs, want] of PRISTINE) {
    let now: Buffer | null;
    try {
      now = existsSync(abs) ? readFileSync(abs) : null;
    } catch (error) {
      /* 读不到也当成「被动过」交上去报：这里没有「静默跳过」那一档 —— 跳一次，
       * 这道网就在不判任何东西而账面照样绿。 */
      touched.push(
        `${abs} → 读当前内容失败：${String(error instanceof Error ? error.message : error)}`,
      );
      continue;
    }
    const same = now === null || want === null ? now === want : now.equals(want);
    if (!same) {
      touched.push(abs);
    }
  }
  expect(
    touched,
    `探针不该写真实工作树（ISSUE #2665）：下面这些真实入库文件在本文件跑的过程中被改过 —— ` +
      `写探针要落在克隆里（\`REPO_ROOT\`），不是 \`REAL_ROOT\`。\n  ${touched.join("\n  ")}`,
  ).toEqual([]);
});

afterAll(() => {
  PROBE.dispose();
});

/**
 * 探针用的写文件：写完**读回来核对**，被占用或内容不符就重试。
 * 这些用例会临时改真实文件、跑一次 `doc:check` 子进程、再还原。Windows 上刚被
 * 子进程读过的文件会短暂占用，实测两次把 `writeFileSync` 直接打抛
 * （`UNKNOWN: unknown error, open …`）：一次抛在还原那一步，探针文本就**留在了仓库里**
 * （追加进 `docs/guides/DEV-QUERIES.md` 的那行就是这么来的，还被 `doc:render` 连生成态一起写脏）；
 * 另一次抛在写入那一步，用例得到一个与判据无关的红。两者都不该由一次瞬时占用决定成败。
 */
function writeText(abs: string, text: string): void {
  let lastError = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      writeFileSync(abs, text, "utf8");
      if (readFileSync(abs, "utf8") === text) {
        return;
      }
      lastError = "写回后读回的内容与预期不一致";
    } catch (error) {
      /* SAFETY: 类型断言已复核 */
      lastError = (error as Error).message;
    }
  }
  throw new Error(
    `写入失败（重试 8 次仍未成功）：${abs} —— ${lastError}。` +
      "该文件里可能残留探针文本，请手工核对后再提交。",
  );
}

function restoreText(abs: string, text: string): void {
  writeText(abs, text);
}

/**
 * 门禁口径的扫描面，**与判据同源**：AGENTS.md + 两份索引 + 登记表 + SCOPED_DOCS。
 * 「哪条判据在哪跑」写在 SCOPED_DOCS 之外的那几份文件里，不显式并入就没人核（§13.5.10 第 ② 条）。
 */
async function gateDocs(): Promise<Array<string>> {
  const mod =
    /* SAFETY: 类型断言已复核 */ (await import("../scripts/doc-facts.cjs")) as unknown as {
      SCOPED_DOCS: Array<string>;
    };
  return [
    ...new Set([
      "AGENTS.md",
      "docs/README.md",
      "README.md",
      "docs/reference-facts.md",
      ...mod.SCOPED_DOCS,
    ]),
  ];
}

/**
 * 「这条判据真的被 `main()` 调用了吗」—— 不能用 `toContain(调用文本)`。
 * 把那一行前面加 `// ` 注掉，行里仍含同一段字面量，`toContain` 照样命中（实测：
 * 本文件里四处「已接入 main 流程」的老写法第一次变异全都绿着放过，ISSUE #1374）。
 * 这里要求它是一行**独立语句**：行首只有缩进、结尾是分号。
 */
function isCalledInMain(script: string, call: string): boolean {
  const mainBody = script.slice(script.indexOf("function main()"));
  const escaped = call.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`^[ \\t]*${escaped};$`, "m").test(mainBody);
}

describe("check-doc-references.cjs（pnpm doc:check）", () => {
  it("当前仓库文档引用与权威源一致（无存量裸值）", () => {
    const { code, output } = runCheck();
    expect(output).toContain("[doc:check] ✓");
    expect(code).toBe(0);
  });

  it("报告里的裸值提示指向登记表与占位符", async () => {
    // 裸值检测的文案契约：命中时必须给出「占位符 + 登记表」两条指引，
    // 否则维护者不知道改什么。用正则锁原文，避免文案退化成沉默通过。
    const facts = await loadFacts();
    const splash = facts.find((f) => f.key === "shell.splash");
    expect(splash?.kind).toBe("placeholder");
    expect(splash?.placeholder).toBe("{{shell.splash}}");
    expect(splash?.extract()).toBe("splash.html");
  });
});

describe("FACTS 的并行引用点（onlyDocs ∪ otherDocs）", () => {
  it("comfyui.port 同时覆盖 workshop-mcp 与主规范「开发端口」行", async () => {
    const facts = await loadFacts();
    const fact = facts.find((f) => f.key === "comfyui.port");
    expect(fact?.onlyDocs).toContain("docs/workshop-mcp.md");
    expect(fact?.otherDocs).toContain("docs/standards/Comfy-APP-T3-项目开发规范.md");
  });

  it("docs/reference-facts.md 如实登记 otherDocs 的存在与语义", () => {
    const text = docText("docs/reference-facts.md");
    expect(text).toContain("otherDocs");
    expect(text).toContain("onlyDocs ∪ otherDocs");
  });

  it("校验脚本按 onlyDocs ∪ otherDocs 取并集，而不是只看 onlyDocs", () => {
    const src = docText("scripts/check-doc-references.cjs");
    expect(src).toContain("f.otherDocs");
  });
});

describe("07 章 splash 三份副本（shell.splash 引用点）", () => {
  const doc = "docs/standards/07-日志系统.md";

  it("编辑态文档用占位符而非裸值", () => {
    const text = docText(doc);
    expect(text).toContain("src-tauri/splash-assets/{{shell.splash}}");
    expect(text).toContain("public/{{shell.splash}}");
    // 裸值不得回潮（完整路径形态）
    expect(text).not.toContain("splash-assets/splash.html");
    expect(text).not.toContain("public/splash.html");
  });

  it("本文声明了占位符约定（与其它纳入校验的文档一致）", () => {
    const text = docText(doc);
    expect(text).toContain("占位符约定");
    expect(text).toContain("docs/reference-facts.md");
  });

  it("生成态文档把占位符还原成真实值供直接阅读", () => {
    const text = docText("docs/generated/07-日志系统.md");
    expect(text).toContain("src-tauri/splash-assets/splash.html");
    expect(text).toContain("public/splash.html");
    expect(text).not.toContain("{{shell.splash}}");
  });
});

describe("主规范「开发端口」行（comfyui.port 第二引用点）", () => {
  const doc = "docs/standards/Comfy-APP-T3-项目开发规范.md";

  it("端口行用占位符，dev 端口保留直观值", () => {
    const text = docText(doc);
    expect(text).toContain("dev server `localhost:3100`");
    expect(text).toContain(":{{comfyui.port}}");
    // 8188 不得以裸值形态残留（`:8188` 会被裸值正则命中）
    expect(text).not.toContain(":8188`");
  });

  it("占位符仍解析得出 ComfyUI 默认端口（生成态可见真实值）", async () => {
    const facts = await loadFacts();
    const fact = facts.find((f) => f.key === "comfyui.port");
    expect(fact?.extract()).toBe("8188");
    expect(docText("docs/generated/Comfy-APP-T3-项目开发规范.md")).toContain(":8188`");
  });
});

describe("校验范围守卫（SCOPED_DOC_DIRS / SCOPED_DOC_EXEMPTIONS）", () => {
  /* 守卫的目的：让「新增规范文档忘了登记 → doc:check 静默跳过它」变成硬错误。
   * 此前 `doc:check` 只校验 SCOPED_DOCS 里列出的文档，未登记的新文档写死
   * 过期端口也没人报错——「全量纳管」只是人工承诺。 */

  type ScopeMod = {
    SCOPED_DOC_DIRS: Array<string>;
    SCOPED_DOC_EXEMPTIONS: Record<string, string>;
    SCOPED_DOCS: Array<string>;
  };

  async function loadScope(): Promise<ScopeMod> {
    const mod =
      /* SAFETY: 类型断言已复核 */ (await import("../scripts/doc-facts.cjs")) as unknown as ScopeMod;
    return mod;
  }

  it("仓库当前不存在「未登记也未豁免」的规范文档（守卫基线为绿）", async () => {
    const { SCOPED_DOCS, SCOPED_DOC_DIRS, SCOPED_DOC_EXEMPTIONS } = await loadScope();
    expect(SCOPED_DOC_DIRS.length).toBeGreaterThan(0);
    const scoped = new Set(SCOPED_DOCS);
    const { readdirSync, statSync } = await import("node:fs");

    const offenders: Array<string> = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(REPO_ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(REPO_ROOT, rel)).isDirectory()) {
          walk(rel);
          continue;
        }
        if (!name.endsWith(".md")) {
          continue;
        }
        if (!scoped.has(rel) && !(rel in SCOPED_DOC_EXEMPTIONS)) {
          offenders.push(rel);
        }
      }
    };
    SCOPED_DOC_DIRS.forEach(walk);
    expect(offenders).toEqual([]);
  });

  it("新增一个未登记的规范文档 → doc:check 失败并点名该文件", () => {
    const temp = join(REPO_ROOT, "docs", "standards", "99-temp-unregistered.md");
    writeFileSync(temp, "# 临时未登记文档\n\n端口 localhost:9999\n", "utf8");
    try {
      const { code, output } = runCheck();
      expect(code).not.toBe(0);
      expect(output).toContain("99-temp-unregistered.md");
      expect(output).toContain("SCOPED_DOCS");
      expect(output).toContain("豁免名单");
    } finally {
      rmSync(temp, { force: true });
    }
  });

  it("豁免名单每一条都必须写理由：空理由 = 报错（豁免要可核验，不能沉默跳过）", async () => {
    const { SCOPED_DOC_EXEMPTIONS } = await loadScope();
    for (const [, reason] of Object.entries(SCOPED_DOC_EXEMPTIONS)) {
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("豁免名单里的条目必须指向实际存在的文件（过期条目应删除）", async () => {
    const { SCOPED_DOC_EXEMPTIONS } = await loadScope();
    for (const rel of Object.keys(SCOPED_DOC_EXEMPTIONS)) {
      expect(existsSync(join(REPO_ROOT, rel)), `${rel} 不存在`).toBe(true);
    }
  });

  it("守卫已接入 main 流程（不是定义了却没人调用）", () => {
    const script = readFileSync(CHECK, "utf8");
    expect(script).toContain("checkScopeCoverage()");
    // 必须被 main 以独立语句调用，而不是「文本里出现过」（见 isCalledInMain 的变异实测）
    expect(isCalledInMain(script, "checkScopeCoverage()")).toBe(true);
  });
});

describe("台账命令口径守卫（AGENTS 硬规则 1：包管理只用 pnpm）", () => {
  /* 目的：文档里的 npm run / npx 不会编译报错，只会静静过期——复核全靠人肉逐行读。
   * 该守卫把「SCOPED_DOCS 里出现可执行 npm/npx 命令」变成硬错误，
   * 同时放行**说明性引用**（写出「改为/修正/pnpm」等纠正词的上下文）。 */

  it("已接入 main 流程（不是定义了却没人调用）", () => {
    const script = readFileSync(CHECK, "utf8");
    expect(script).toContain("function checkLedgerCommands()");
    expect(isCalledInMain(script, "checkLedgerCommands()")).toBe(true);
  });

  it("台账里不再有可执行的 npm run / npx 命令", () => {
    for (const doc of [
      "docs/guides/PRODUCTION-GAPS.md",
      "docs/guides/DEV-QUERIES.md",
      "docs/guides/TESTING.md",
    ]) {
      const lines = docText(doc).split("\n");
      lines.forEach((line, i) => {
        if (!/(^|[\s`(（])(npm\s+run|npx)\b/.test(line)) {
          return;
        }
        expect(
          /改为|修正|修正为|pnpm|禁止|违反|原记录|不要用|应使用/.test(line),
          `${doc}:${i + 1} 出现 npm/npx 可执行命令且未标注为说明：${line.trim()}`,
        ).toBe(true);
      });
    }
  });

  /* 用一个**已登记**的文档做探针：临时改写它的内容、跑校验、再还原。
   * 不能新建临时文件——那会先被「校验范围守卫」拦下（未登记），
   * 测不到本守卫，得到假绿。 */
  function withRegisteredDocProbe(appended: string): {
    code: number;
    output: string;
  } {
    const probe = "docs/guides/DEV-QUERIES.md";
    const original = readFileSync(join(REPO_ROOT, probe), "utf8");
    writeText(join(REPO_ROOT, probe), `${original}\n${appended}\n`);
    try {
      return runCheck();
    } finally {
      restoreText(join(REPO_ROOT, probe), original);
    }
  }

  it("把 npm 命令写进已登记的文档 → doc:check 失败并给出改法", () => {
    const { code, output } = withRegisteredDocProbe("```bash\nnpm run test:e2e\n```");
    expect(code).not.toBe(0);
    expect(output).toContain("DEV-QUERIES.md");
    expect(output).toContain("硬规则 1");
    expect(output).toContain("pnpm");
  });

  it("npx 同样被拦下", () => {
    const { code, output } = withRegisteredDocProbe("```bash\nnpx tsc --noEmit\n```");
    expect(code).not.toBe(0);
    expect(output).toContain("npx");
  });

  it("说明性引用被放行（描述规则本身不算违规）", () => {
    const { code } = withRegisteredDocProbe(
      "命令类：`npm run` 一律改为 `pnpm`（AGENTS 硬规则 1）。",
    );
    expect(code).toBe(0);
  });

  it("当前仓库台账已无存量违规（守卫基线为绿）", () => {
    const { code, output } = runCheck();
    expect(code).toBe(0);
    expect(output).toContain("[doc:check] ✓");
  });
});

describe("用户面文档不许教跑不通的驱动（ISSUE #2580）", () => {
  /* 现场：`docs/guide-database-backup.md` 教的是 `require('better-sqlite3')` 的在线
   * `backup()` 与 `pragma('integrity_check')`，而那包是 devDependencies —— 桌包用户与
   * standalone 运行期根本没有它，照抄就是 `MODULE_NOT_FOUND`，动的还是用户数据。
   * 机制（`VACUUM INTO`）、台账（D6）、核心实现与「不许出现那三个字样」的断言都早已改，
   * 漏的是**给用户看的那一页**，所以这条挂在 doc:check（§13.5.17 那一档）上。
   *
   * 判据只认**可执行命令形状**（`require(…)` / `from …`），不认名字：规范里大量正当句子
   * 在讲「当年为什么换掉它」。上面那条「台账命令口径」组用的探针文件（DEV-QUERIES.md）
   * 已在 `PROBE_TARGETS` 的快照网里，这里复用同一份 ⇒ 不把新的入库文档拖进写探针的窗口。 */
  const probe = "docs/guides/DEV-QUERIES.md";

  function withProbe(appended: string): { code: number; output: string } {
    const abs = join(REPO_ROOT, probe);
    const original = readFileSync(abs, "utf8");
    writeText(abs, `${original}\n${appended}\n`);
    try {
      return runCheck();
    } finally {
      restoreText(abs, original);
    }
  }

  it("已接入 main 流程（定义了却没人调用 = 没有执行者）", () => {
    const script = readFileSync(CHECK, "utf8");
    expect(script).toContain("function checkRuntimeAbsentDriverCommands()");
    expect(isCalledInMain(script, "checkRuntimeAbsentDriverCommands()")).toBe(true);
  });

  it("把 require 形状写进用户面文档 → 红，点名文件行号并给出真在场的出口", () => {
    const { code, output } = withProbe(
      "```bash\nnode -e \"const D=require('better-sqlite3'); const db=new D('db.sqlite'); console.log(db.pragma('integrity_check'));\"\n```",
    );
    expect(code, "命令形状必须让 doc:check 红").not.toBe(0);
    expect(output).toContain(probe);
    expect(output).toContain("devDependencies");
    expect(output, "红话必须给得出路，而不只是说不能用").toContain("node:sqlite");
    expect(output).toContain("pnpm db:backup");
  });

  it("`from 'better-sqlite3'`（ESM 那一形）同样拦下", () => {
    const { code, output } = withProbe('```js\nimport Database from "better-sqlite3";\n```');
    expect(code).not.toBe(0);
    expect(output).toContain(probe);
  });

  it("同一行带纠正词 ⇒ 是说明而不是命令（放行）", () => {
    const { code, output } = withProbe(
      "备份指南里那种 `require('better-sqlite3')` 的写法**没有**在线备份可用：" +
        "它是 devDependencies，生产运行时不存在这个包，请改为 `pnpm db:backup`。",
    );
    expect(output, "放行时不该顺带把别的规则念成红").toContain("[doc:check] ✓");
    expect(code).toBe(0);
  });

  /* 这条钉的是「窄到命令形状」那一格本身：真仓库此刻的用户面文档里，`better-sqlite3`
   * 这个名字**确实在散文中出现**（§1 与 §2.2 那两句正是「讲别用它的理由」），而 doc:check
   * 是绿的。先断言这些散文在场，再断言绿 —— 否则有人把那两句删掉之后，这条会退化成
   * 「什么都判不出来的一条绿」（与 §13.5.12「反向自证」同一口径）。 */
  it("基线为绿，且绿不是靠「面内一个字都没提」换来的", () => {
    const guide = docText("docs/guide-database-backup.md");
    expect(
      guide.split("\n").filter((l) => l.includes("better-sqlite3")).length,
      "指南里必须有讲明「为什么不能用它」的散文，否则下面那条绿没有对象",
    ).toBeGreaterThan(0);
    for (const line of guide.split("\n")) {
      if (!line.includes("better-sqlite3")) {
        continue;
      }
      expect(line, "散文可以提名字，但不许留成能被复制粘贴执行的那一行").not.toMatch(
        /require\(\s*["']better-sqlite3["']\s*\)|from\s+["']better-sqlite3["']/,
      );
    }
    const { code, output } = runCheck();
    expect(output).toContain("[doc:check] ✓");
    expect(code).toBe(0);
  });
});

describe("AGENTS.md ↔ standards 漂移守卫", () => {
  /* 目的：AGENTS.md 是代理自动加载的唯一导航文件，历史上两处漂移都恰好
   *      落在 SCOPED_DOCS 的盲区（AGENTS.md 在仓库根，docs/ 才纳入）。
   *      checkAgentsMdDrift 承担 C1/C3（路径存在性）+ C2（章节锚点）；
   *      C4（npm/npx 命令）由 checkLedgerCommands 显式并入 AGENTS.md 承担——
   *      AGENTS.md 不进 SCOPED_DOCS，否则 render-doc-placeholders 会为它
   *      生成一份没有 {{占位符}} 的 docs/generated/AGENTS.md 冗余副本。
   *      判据细节见 scripts/check-doc-references.cjs 顶部的段注释。 */

  it("已接入 main 流程（不是定义了却没人调用）", () => {
    const script = readFileSync(CHECK, "utf8");
    expect(script).toContain("function checkAgentsMdDrift()");
    expect(isCalledInMain(script, "checkAgentsMdDrift()")).toBe(true);
  });

  it("AGENTS.md 由 checkLedgerCommands 显式并入遍历（不进 SCOPED_DOCS、避免生成冗余副本）", async () => {
    const mod =
      /* SAFETY: 类型断言已复核 */ (await import("../scripts/doc-facts.cjs")) as unknown as {
        SCOPED_DOCS: Array<string>;
      };
    // AGENTS.md 刻意不入 SCOPED_DOCS：进则被 render-doc-placeholders 复制成
    // docs/generated/AGENTS.md，产物里没有占位符替换、只是同一份内容，反而
    // 让读者以为可以改产物（规范 §13.5.5 明确「禁止手改生成物」）。
    expect(mod.SCOPED_DOCS).not.toContain("AGENTS.md");
    const script = readFileSync(CHECK, "utf8");
    const ledgerBody = script.slice(
      script.indexOf("function checkLedgerCommands()"),
      script.indexOf("function shouldApplyFactToDoc"),
    );
    expect(ledgerBody).toMatch(/\[\s*AGENTS_MD_PATH\s*,\s*\.\.\.SCOPED_DOCS\s*\]/);
  });

  it("当前 AGENTS.md 无漂移（基线为绿）", () => {
    const { code, output } = runCheck();
    expect(code).toBe(0);
    expect(output).toContain("[doc:check] ✓");
  });

  /* 反向探针：直接改 AGENTS.md 末尾、跑校验、还原。不能新建临时文件——
   * 那会被「校验范围守卫」拦下（未登记），测不到本守卫。 */
  function withAgentsMdProbe(appended: string): {
    code: number;
    output: string;
  } {
    const target = join(REPO_ROOT, "AGENTS.md");
    const original = readFileSync(target, "utf8");
    writeText(target, `${original}\n${appended}\n`);
    try {
      return runCheck();
    } finally {
      restoreText(target, original);
    }
  }

  it("AGENTS.md 里出现不存在的路径 → doc:check 失败并点名行号", () => {
    const { code, output } = withAgentsMdProbe(
      "临时探针：`scripts/__agents_md_drift_probe__.mjs` 用于测试。",
    );
    expect(code).not.toBe(0);
    expect(output).toContain("AGENTS.md:L");
    expect(output).toContain("__agents_md_drift_probe__.mjs");
    expect(output).toContain("在仓库中不存在");
  });

  it("AGENTS.md 里写了某章节号但目标 standards 文件里找不到锚点 → doc:check 失败", () => {
    // 同行给出文件链接 + 不存在的 §13.99，触发 C2 锚点核对。
    const { code, output } = withAgentsMdProbe(
      "临时探针：见 [13-提交与-code-review.md](docs/standards/13-提交与-code-review.md) §13.99。",
    );
    expect(code).not.toBe(0);
    expect(output).toContain("AGENTS.md:L");
    expect(output).toContain("§13.99");
    expect(output).toContain("未找到对应标题锚点");
  });

  /* 运行期产物（被 .gitignore 忽略）不得被要求存在。
   * 判据是 62283f41 那次引入的恒红：`db.sqlite` 进了 AGENTS_ROOT_FILES，而它
   * 被 .gitignore 忽略——干净检出（CI / 新克隆 / 评审容器）里永远不存在，于是
   * `pnpm doc:check` 一直报这一条，而「按提示改 AGENTS.md」是错的（那句话本来就
   * 该提这个文件名，它讲的是「构建会把它复制进产物」）。 */
  it("被 .gitignore 忽略的根级产物（`db.sqlite`）不参与「必须存在」判定", () => {
    const { code, output } = runCheck();
    expect(output).toContain("[doc:check] ✓");
    expect(code).toBe(0);
    // AGENTS.md 里确实写着它（反向保护：不是靠「文档里没这句」换来的绿）
    expect(docText("AGENTS.md")).toContain("`db.sqlite`");
    expect(docText(".gitignore")).toMatch(/^db\.sqlite$/m);
  });

  it("豁免判据落在 .gitignore 上，不是又列一份人工名单", () => {
    const script = readFileSync(CHECK, "utf8");
    expect(script).toContain("function gitignoredRootNames()");
    expect(script).toContain("GITIGNORED_ROOT_NAMES.has(p)");
    // 反向：真不存在的路径仍要拦（豁免只覆盖 .gitignore 里登记过的名字）。
    expect(script).toContain("在仓库中不存在");
  });

  /* 运行期产物的**目录形态**同样豁免（2026-10-23，ISSUE #2231 的连带）。
   *
   * `docs/api/` 进 `.gitignore` 之后，AGENTS.md 里「产物落在 `docs/api/`」那句话在新克隆里
   * 指向一个**不存在**的目录 ⇒ `pnpm doc:check` 在 CI 上恒红，而「按提示去改 AGENTS.md」
   * 是错的 —— 那句话讲的是「产物落在哪」，不是「仓库里有这个目录」。旧实现只豁免根级**单名**
   * （`db.sqlite`），嵌套形态没有豁免：同一个洞，只是要等第一个嵌套形态出现。
   *
   * 为什么必须是**差分**探针：本机跑过 `pnpm run docs` 的话 `docs/api/` 是真存在的 ⇒
   * 「不红」这件事在本机分不出是「豁免生效了」还是「那个目录真的在」⇒ 探针文件必须是
   * **一定不存在**的名字，存在性检查本来会红、豁免让它不红 —— 那才有信号。 */
  it("被 .gitignore 忽略的嵌套目录形态同样豁免（差分探针）", () => {
    const ignored = withAgentsMdProbe("临时探针：`docs/api/__probe_not_exists__.md` 用于测试。");
    expect(ignored.code, ignored.output).toBe(0);
    const notIgnored = withAgentsMdProbe("临时探针：`docs/__probe_not_exists__.md` 用于测试。");
    expect(notIgnored.code).not.toBe(0);
    expect(notIgnored.output).toContain("在仓库中不存在");
  });

  it("路径通配 / 占位符 / range 记法不被误判为路径（零误报回归）", () => {
    // 探针里塞几种典型「看起来像路径但不是路径」的形态，期望 code=0。
    const { code, output } = withAgentsMdProbe(
      [
        "- `src/lib/**` 通配、`docs/standards/01~18` range、",
        "  `tools/<分类>/*.ps1` 占位符、`.server.ts` 简称、",
        "  `Process.Kill()` 代码符号——都不应被 C1/C3 判成路径。",
      ].join(""),
    );
    expect(code).toBe(0);
    expect(output).toContain("[doc:check] ✓");
  });
});

/**
 * 门禁步骤的「序号引用」口径（ISSUE #1374，签字：删序号、改用日志里打印的标签）。
 *
 * 为什么这条要钉住：钩子早已是「组 0 + A/B/C/D 四个并行组」，「第 N 步」在这份形状上
 * 没有唯一解释；而序号不属于任何现有事实核，所以每给 D 组追加一步，文档里那批数字
 * 就整体错位一次 —— 表现不是红，是**指到别的判据上**（立案时的实测样本：UI 基元复用
 * 棘轮写作「第 12 步」而实际第 9 条、生成态文档同步写作「第 26 步」而实际第 21 条）。
 *
 * 与 `tests/doc-check-hook-wiring.test.ts` 的分工：那份守「这一步在不在钩子里」，
 * 本组守「文档怎么引用这一步」。
 */
describe("文档不许用「第 N 步」引用门禁步骤（ISSUE #1374）", () => {
  const STEP_RE = /第\s*\d+(?:\s*\/\s*\d+)?\s*步/;
  const GATE_RE = /pre-commit|\.githooks|\bCI\b/;
  const EXPLAIN_RE = /不写|别再|不要写|禁止|应写|应改|一律|改成|序号|没有唯一|已删|已随|历史/;

  /** 临时在一份文档尾部加探针、跑校验、再还原（finally 保证红的时候也还原）。 */
  function withProbe(
    doc: string,
    appended: string,
  ): {
    code: number;
    output: string;
  } {
    const target = join(REPO_ROOT, doc);
    const original = readFileSync(target, "utf8");
    writeText(target, `${original}\n${appended}\n`);
    try {
      return runCheck();
    } finally {
      restoreText(target, original);
    }
  }

  it("已接入 main 流程（不是定义了却没人调用）", () => {
    /* 判据本体住在 `check-doc-gate-refs.cjs`（与上文那一半「硬编码值 / 路径 / 端口」
     * 不是一件事，两份合住一份时越过文件长度硬闸），而**接入点**仍在 `main` 里：
     * 所以两件事各读一份文件 —— 拿 `check-doc-references.cjs` 去找函数定义会落空，
     * 那是「它搬了家」而不是「它没接上」。 */
    expect(gateRefsSource()).toContain("function checkGateStepIndexRefs(problems)");
    const script = readFileSync(CHECK, "utf8");
    /* 接入形态是 `checkGateStepIndexRefs(problems)`：判据把结论 push 进主脚本的
     * `problems` 数组（探针树里跑的是真脚本，全局变量不存在）。 */
    expect(isCalledInMain(script, "checkGateStepIndexRefs(problems)")).toBe(true);
  });

  it("量具自己没坏：注释掉的调用不算「已接入」", () => {
    // 这条是 isCalledInMain 自己的对照 —— 变异实测发现旧写法（`toContain`）在
    // `// checkX();` 之下仍然绿，也就是「接入判据」本身是个假判据（ISSUE #1374）。
    const wired = "function main() {\n  checkGateStepIndexRefs();\n}\n";
    const muted = "function main() {\n  // checkGateStepIndexRefs();\n}\n";
    expect(isCalledInMain(wired, "checkGateStepIndexRefs()")).toBe(true);
    expect(isCalledInMain(muted, "checkGateStepIndexRefs()")).toBe(false);
  });

  it("存量 = 0：扫描面上每条「序号 + 门禁」同行都必须带纠正词", async () => {
    const docs = await gateDocs();
    let scanned = 0;
    for (const doc of docs) {
      if (!existsSync(join(REPO_ROOT, doc))) {
        continue;
      }
      scanned += 1;
      docText(doc)
        .split("\n")
        .forEach((line, i) => {
          if (!STEP_RE.test(line) || !GATE_RE.test(line)) {
            return;
          }
          expect(
            EXPLAIN_RE.test(line),
            `${doc}:${i + 1} 用「第 N 步」引用门禁步骤且未标注为说明：${line.trim().slice(0, 80)}`,
          ).toBe(true);
        });
    }
    // 防空转：扫描面解析不出任何文档时，上面那条循环等于什么都没测。
    expect(scanned).toBeGreaterThan(20);
  });

  it("种一条「.githooks/pre-commit 第 99 步」→ 失败，并点名行号与标签形态的改法", () => {
    const { code, output } = withProbe(
      "docs/guides/DEV-QUERIES.md",
      "临时探针：该判据在 `.githooks/pre-commit` 第 99 步。",
    );
    expect(code).not.toBe(0);
    expect(output).toContain("docs/guides/DEV-QUERIES.md:");
    expect(output).toContain("第 99 步");
    expect(output).toContain("序号没有唯一解释");
    expect(output).toContain("── check:");
  });

  it("AGENTS.md 也在扫描面内（它是代理自动加载的导航文件）", () => {
    const { code, output } = withProbe("AGENTS.md", "临时探针：门禁见 pre-commit 第 98 步。");
    expect(code).not.toBe(0);
    expect(output).toContain("[AGENTS.md:");
    expect(output).toContain("第 98 步");
  });

  it("登记表 docs/reference-facts.md 也在扫描面内（它不在 SCOPED_DOCS 里）", () => {
    // 这份文件是 doc:check 自己的事实登记表 —— FACTS 通过 ASCII_ONLY_FACT_DOCS 读它，
    // 不走 SCOPED_DOCS，所以「哪条判据在哪跑」写在这里时若不排除在外，就正好没人核。
    const { code, output } = withProbe(
      "docs/reference-facts.md",
      "临时探针：该步在 pre-commit 第 97 步。",
    );
    expect(code).not.toBe(0);
    expect(output).toContain("[docs/reference-facts.md:");
    expect(output).toContain("第 97 步");
  });

  it("描述这条口径本身（同行带纠正词）→ 放行", () => {
    const { code, output } = withProbe(
      "docs/guides/DEV-QUERIES.md",
      "引用门禁步骤一律写标签，别按「pre-commit 第 12 步」这种序号写（序号没有唯一解释）。",
    );
    expect(code).toBe(0);
    expect(output).toContain("[doc:check] ✓");
  });

  it("有主人的过程序号不被误伤（同一行没有 pre-commit / .githooks / CI）", () => {
    const { code, output } = withProbe(
      "docs/guides/DEV-QUERIES.md",
      "按 §2.2 第 5 步做依赖预检；`scripts/prepare-local-run.ps1` 第 3 步补齐 `.env`。",
    );
    expect(code).toBe(0);
    expect(output).toContain("[doc:check] ✓");
  });

  it("changelog.d 的历史碎片不被扫（碎片是当时那次变更的记录，不许改写）", () => {
    // 反向钉边界：AGENTS 硬规则 14 / §13.10.5 把碎片定成「一件变更一个文件」的账本，
    // 里面的「pre-commit 第 26 步」是当时的历史事实，判据去追它等于伪造证据。
    const probe = join(REPO_ROOT, "changelog.d", "zz-step-index-probe.md");
    writeFileSync(
      probe,
      "## Fixed\n\n- 临时探针：`docs/README.md` 曾写 pre-commit 第 26 步、CI 第 30 步。\n",
      "utf8",
    );
    try {
      const { code, output } = runCheck();
      expect(code).toBe(0);
      expect(output).not.toContain("zz-step-index-probe");
    } finally {
      rmSync(probe, { force: true });
    }
  });
});

describe("§13.1 那份清单与 pre-commit 的 D 组逐字一致（ISSUE #1404）", () => {
  const HOOK_REL = ".githooks/pre-commit";
  const DOC_REL = "docs/standards/13-提交与-code-review.md";
  const CHECKLIST_MARKER = "本地提交前必须通过";

  /** 与判据同源的两侧解析（写在测试里 = 双向对照：判据漏解析，这条用例会自己发现）。 */
  function hookCommands(): Array<string> {
    const text = docText(HOOK_REL);
    return [...text.matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) =>
      (m[2] ?? "").replaceAll(/\s+/g, " ").trim(),
    );
  }
  function docCommands(): Array<string> {
    const text = docText(DOC_REL);
    const start = text.indexOf(CHECKLIST_MARKER);
    const rest = text.slice(start);
    const close = rest.indexOf("```");
    expect(start, "§13.1 的 marker 还在吗？判据与这条用例都要靠它定位").toBeGreaterThan(-1);
    expect(close, "marker 之后找不到围栏收尾").toBeGreaterThan(-1);
    return rest
      .slice(0, close)
      .split("\n")
      .filter((l) => l.startsWith("✅ "))
      .map((l) => (l.slice(2).split(/ +# /)[0] ?? "").replaceAll(/\s+/g, " ").trim());
  }

  /** 精确替换一次：命中 0 次或 ≥2 次都直接抛 —— 否则文档一改措辞，探针就静默失效，
   *  用例得到「意外绿」，而这正是本刀要拦的那个形状。 */
  function replaceOnce(text: string, from: string, to: string): string {
    const hits = text.split(from).length - 1;
    if (hits !== 1) {
      throw new Error(`探针锚点命中 ${hits} 次（应为 1）：${from.slice(0, 60)}`);
    }
    return text.replace(from, to);
  }

  function withDocProbe(mutate: () => void): { code: number; output: string } {
    const abs = join(REPO_ROOT, DOC_REL);
    const original = readFileSync(abs, "utf8");
    mutate();
    try {
      return runCheck();
    } finally {
      restoreText(abs, original);
    }
  }

  it("已接入 main 流程（不是定义了却没人调用）", () => {
    expect(gateRefsSource()).toContain("function checkGateChecklistMatchesHook(problems)");
    /* 接入点读主脚本：函数定义在分片、调用在 `main`，两件事读两个文件。 */
    expect(
      isCalledInMain(readFileSync(CHECK, "utf8"), "checkGateChecklistMatchesHook(problems)"),
    ).toBe(true);
  });

  it("量具自己没坏：注释掉的调用不算「已接入」", () => {
    const wired = "function main() {\n  checkGateChecklistMatchesHook(problems);\n}\n";
    const muted = "function main() {\n  // checkGateChecklistMatchesHook(problems);\n}\n";
    expect(isCalledInMain(wired, "checkGateChecklistMatchesHook(problems)")).toBe(true);
    expect(isCalledInMain(muted, "checkGateChecklistMatchesHook(problems)")).toBe(false);
  });

  it("存量 = 0：钩子 D 组的每一步都在清单里，且 flag 逐字一致", () => {
    const hook = hookCommands();
    const doc = new Set(docCommands());
    expect(hook.length, "解析不出钩子步骤，这条用例等于什么都没测").toBeGreaterThanOrEqual(25);
    for (const cmd of hook) {
      expect(doc.has(cmd), `清单里缺这一条（或 flag 不一致）：${cmd}`).toBe(true);
    }
  });

  it("把清单里那一步的 --staged 抹掉 → 红，并点名是哪一步", () => {
    // 锚点必须是**今天两侧都带这个 flag** 的一步：这条用例最早拿
    // `check-file-structure.cjs --strict` 当锚点，而 ISSUE #1811 的 R5 项把 `--strict`
    // 从钩子与清单里一并删了 —— 锚点命中 0 次（`replaceOnce` 直接抛），这条用例
    // 在任何检出上都红，且红的原因与「flag 漂移没被抓住」毫无关系。
    // 换成 `check-function-length.cjs --staged`（钩子 D 组与清单两侧都在）。
    const { code, output } = withDocProbe(() => {
      const abs = join(REPO_ROOT, DOC_REL);
      writeText(
        abs,
        replaceOnce(
          readFileSync(abs, "utf8"),
          "✅ node scripts/check-function-length.cjs --staged",
          "✅ node scripts/check-function-length.cjs",
        ),
      );
    });
    expect(code).not.toBe(0);
    expect(output).toContain("node scripts/check-function-length.cjs --staged");
    expect(output).toContain("flag 与钩子不一致");
  });

  it("清单漏登记一步（新增判据忘了同步）→ 红", () => {
    const { code, output } = withDocProbe(() => {
      const abs = join(REPO_ROOT, DOC_REL);
      writeText(
        abs,
        replaceOnce(
          readFileSync(abs, "utf8"),
          "✅ node scripts/check-title-bar-clearance.cjs --staged # 输入面跳过（见下 13.5.8.2）\n",
          "",
        ),
      );
    });
    expect(code).not.toBe(0);
    expect(output).toContain("node scripts/check-title-bar-clearance.cjs");
    expect(output).toContain("§13.1 清单里没有这条");
  });

  it("清单留着一条钩子已经不跑的命令 → 红（那句「清单就是全文」不许假）", () => {
    const { code, output } = withDocProbe(() => {
      const abs = join(REPO_ROOT, DOC_REL);
      writeText(
        abs,
        replaceOnce(
          readFileSync(abs, "utf8"),
          "✅ node scripts/check-comment-language.cjs",
          "✅ node scripts/zz-pretend-judge.cjs\n✅ node scripts/check-comment-language.cjs",
        ),
      );
    });
    expect(code).not.toBe(0);
    expect(output).toContain("node scripts/zz-pretend-judge.cjs");
    expect(output).toContain("的 D 组没有这一步");
  });
});

describe("门禁的步数也不许写进文档（ISSUE #1407，签字口径 (a)）", () => {
  const COUNT_RE = /[0-9]+\s*步/;
  const ORDINAL_RE = /第\s*\d+(?:\s*\/\s*\d+)?\s*步/;
  const GATE_RE = /pre-commit|\.githooks|\bCI\b/;
  const EXPLAIN_RE =
    /不写|别再|不要写|禁止|应写|应改|一律|改成|序号|没有唯一|已删|已随|历史|不再|过期/;
  const DOC11_REL = "docs/standards/11-测试与可观测性.md";

  /** 往一份已登记文档尾部追加一行探针，跑校验，再还原（重试式写入见 `writeText`）。 */
  function withAppendedProbe(doc: string, appended: string) {
    const abs = join(REPO_ROOT, doc);
    const original = readFileSync(abs, "utf8");
    writeText(abs, `${original}\n${appended}\n`);
    try {
      return runCheck();
    } finally {
      restoreText(abs, original);
    }
  }

  it("已接入 main 流程（定义了却没人调用 = 假判据）", () => {
    expect(gateRefsSource()).toContain("function checkGateStepCounts(problems)");
    /* 同上：定义在分片、调用在 `main`。 */
    expect(isCalledInMain(readFileSync(CHECK, "utf8"), "checkGateStepCounts(problems)")).toBe(true);
  });

  it("量具自己没坏：注释掉的调用不算「已接入」", () => {
    const wired = "function main() {\n  checkGateStepCounts(problems);\n}\n";
    const muted = "function main() {\n  // checkGateStepCounts(problems);\n}\n";
    expect(isCalledInMain(wired, "checkGateStepCounts(problems)")).toBe(true);
    expect(isCalledInMain(muted, "checkGateStepCounts(problems)")).toBe(false);
  });

  it("存量 = 0：扫描面上每条「裸计数 + 门禁锚点」同行都带纠正词", async () => {
    const docs = await gateDocs();
    let scanned = 0;
    for (const doc of docs) {
      if (!existsSync(join(REPO_ROOT, doc))) {
        continue;
      }
      scanned += 1;
      docText(doc)
        .split("\n")
        .forEach((line, i) => {
          if (ORDINAL_RE.test(line)) {
            return;
          } // 序号形态归 checkGateStepIndexRefs，不双报
          if (!COUNT_RE.test(line) || !GATE_RE.test(line)) {
            return;
          }
          expect(
            EXPLAIN_RE.test(line),
            `${doc}:${i + 1} 写了门禁步数且未标注为说明：${line.trim().slice(0, 80)}`,
          ).toBe(true);
        });
    }
    expect(scanned, "扫描面一份都没读到，这条用例等于什么都没测").toBeGreaterThan(20);
  });

  it("种一条「`.githooks/pre-commit`（24 步）」→ 红，并给出指针形态的改法", () => {
    const { code, output } = withAppendedProbe(
      "docs/guides/DEV-QUERIES.md",
      "临时探针：门禁见 `.githooks/pre-commit`（24 步）。",
    );
    expect(code).not.toBe(0);
    expect(output).toContain("docs/guides/DEV-QUERIES.md:");
    expect(output).toContain("写了门禁的步数");
    expect(output).toContain("静默过期");
    expect(output).toContain("1407");
  });

  it("同一行是「第 N 步」时只由序号那条报，不双报", () => {
    const { code, output } = withAppendedProbe(
      "docs/guides/DEV-QUERIES.md",
      "临时探针：那一步是 pre-commit 第 41 步。",
    );
    expect(code).not.toBe(0);
    expect(output).toContain("序号没有唯一解释");
    expect(output).not.toContain("写了门禁的步数");
  });

  it("描述这条口径本身（同行带纠正词）→ 放行", () => {
    const { code, output } = withAppendedProbe(
      "docs/guides/DEV-QUERIES.md",
      "门禁的步数别再写进文档（`.githooks/pre-commit`（24 步）这种数字会静默过期）。",
    );
    /* 红要分得清「判据真拦了说明句」还是「探针没还原把文件留脏了」——
     * 把现场证据带进断言（ISSUE #2415；自愈兜底见文件头的 afterEach）。 */
    expect(code, `放行失败，doc:check 的现场：${output}`).toBe(0);
    expect(output).toContain("[doc:check] ✓");
  });

  it("有主人的过程计数不误伤（`prepare-local-run.ps1` 那种）", () => {
    const { code, output } = withAppendedProbe(
      "docs/guides/DEV-QUERIES.md",
      "临时探针：`prepare-local-run.ps1` 一共 8 步，第 3 步建库。",
    );
    expect(code).toBe(0);
    expect(output).toContain("[doc:check] ✓");
  });

  it("§11 不许再把钩子清单抄一份回来（副本 = 会漂的那一半）", () => {
    const text = docText(DOC11_REL);
    const start = text.indexOf("### 11.7 质量门禁");
    // 只核「钩子清单的镜像」那一段：本节后面还有一段「需要完整验证时手动跑一遍」
    // （db:push / build / E2E / 产物护栏），那是 11.7 自己的手动档建议，不是钩子的副本。
    const end = text.indexOf("需要**完整**验证", start);
    expect(start, "§11.7 的标题变了，这条钉子要跟着改").toBeGreaterThan(-1);
    expect(end, "§11.7 里那段手动档建议的位置变了").toBeGreaterThan(start);
    const slice = text.slice(start, end);
    expect(
      /^✅ /m.test(slice),
      "§11.7 又长出 `✅ …` 那种命令副本了 —— 钩子清单的唯一出处是 §13.1",
    ).toBe(false);
    expect(slice).not.toContain("本地提交前必须通过（.githooks/pre-commit，");
  });
});

/**
 * `pnpm doc:render` 的**自动修档**（`--check --autofix`，ISSUE #1981）。
 *
 * 这一档是平台侧「生成态文档与源同步」那一步在跑的形态：先判一次，红了就地重渲染、
 * 再判一次。它要守的是**三件各不相同的事**，缺一件都会让它变成一个假的绿：
 *
 *   ① **绿的时候不多写**：判定通过时它一次都不许写（否则每次 PR 都在改工作区）；
 *   ② **红了真能修好**：改一份编辑态文档、不动生成物 → 这一档应当自己把它修回来，
 *      并且**结论来自第二次 `--check`**（不是「写入模式退 0 就算通过」）；
 *   ③ **修不好时必须红**：产物被手改（内容与重渲染结果不同）时重渲染能修，
 *      但如果产物**多余**（源已不在 `SCOPED_DOCS` 里），重渲染并不会删它 ——
 *      这一档必须如实报红，而不是「跑过写入模式就当我赢了」。
 *
 * 用子进程跑真脚本（与 `runCheck` 同一条口径）。与这一文件里其它「真文件探针」
 * 组不同，本组的现场是**临时目录里的夹具仓库**（ISSUE #2415）：渲染器按
 * `DOC_RENDER_ROOT` / `DOC_RENDER_SCOPED` 把输入输出根注入到夹具上 ——
 * 本组一次也不写真仓库的入库文件，也不再有「改 → 判 → 改回来」的待恢复状态
 * （写入曾经失败过一次，探针句就留在了主干文档与它的镜像里）。
 */
describe("doc:render 的自动修档（--check --autofix，ISSUE #1981）", () => {
  const RENDER = join(REPO_ROOT, "scripts", "render-doc-placeholders.cjs");
  const EDIT = "docs/guides/DEV-QUERIES.md";

  let fixtureRoot = "";
  const editAbs = () => join(fixtureRoot, EDIT);
  const genAbs = () => join(fixtureRoot, "docs", "generated", "DEV-QUERIES.md");

  function runRender(args: Array<string>): { code: number; output: string } {
    try {
      const output = execFileSync(process.execPath, [RENDER, ...args], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          DOC_RENDER_ROOT: fixtureRoot,
          DOC_RENDER_SCOPED: EDIT,
        },
      });
      return { code: 0, output };
    } catch (error) {
      /* SAFETY: 类型断言已复核 */
      const e = error as {
        status?: number;
        stderr?: string;
        stdout?: string;
      };
      return {
        code: typeof e.status === "number" ? e.status : 1,
        output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
      };
    }
  }

  /** 立一份「源与生成态一致」的底座：写入模式只落在夹具里。 */
  function seedFixture(): void {
    fixtureRoot = mkdtempSync(join(tmpdir(), "doc-render-fixture-"));
    mkdirSync(dirname(editAbs()), { recursive: true });
    writeFileSync(
      editAbs(),
      [
        "# DEV-QUERIES（夹具）",
        "",
        "> **占位符约定**：占位符由 doc:check 动态核对。",
        "",
        "## 查询",
        "",
        "- ComfyUI 端口：{{comfyui.port}}",
        "",
      ].join("\n"),
      "utf8",
    );
    const seeded = runRender([]);
    expect(seeded.code, seeded.output).toBe(0);
    expect(existsSync(genAbs()), seeded.output).toBe(true);
  }

  afterEach(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
    fixtureRoot = "";
  });

  it("绿的时候不多写：判定通过时一句「重新生成」都不打", () => {
    seedFixture();
    const before = readFileSync(genAbs(), "utf8");
    const { code, output } = runRender(["--check", "--autofix"]);
    expect(code, output).toBe(0);
    expect(output).toContain("[doc:render --check] ✓");
    /* 这条是关键：没有这一格，「自动修」退化成「每次都跑一遍写入模式」也照样全绿，
     * 而那意味着每个 PR 都在改工作区（并且掩盖了「它到底修了什么」）。 */
    expect(
      output,
      `夹具（${fixtureRoot}）已 seed 成一致，仍打出「重渲染」就是多写了：${output}`,
    ).not.toContain("重渲染");
    /* 不多写的实物证据：产物字节不变（mtime 不可靠，比内容）。 */
    expect(readFileSync(genAbs(), "utf8")).toBe(before);
  });

  it("编辑态改了、生成物没跟着 → 自动重渲染修好，并如实说明修了什么", () => {
    /* 探针插在标题行紧后面，而不是文末：`renderDocContent()` 会先剥掉编辑文档里
     * 那段「占位符约定」引用块，文末追加的文本会落在它的匹配范围里、被一起剥掉 ——
     * 那样「源改了」这件事根本传不到生成物，这一格就测不到它要测的东西。 */
    seedFixture();
    const original = readFileSync(editAbs(), "utf8");
    const [head, ...rest] = original.split("\n");
    const probed = `${head}\n\n自动修探针：这一行只在编辑态。\n${rest.join("\n")}`;
    writeFileSync(editAbs(), probed, "utf8");
    const { code, output } = runRender(["--check", "--autofix"]);
    expect(output).toContain("落后于源");
    expect(output).toContain("重渲染");
    expect(code, output).toBe(0);
    /* 修的是生成物：探针文本应当出现在产物里（它就是「源 → 生成物」那一份计算的
     * 结果），而**源那一份不许被改**（判据的红话里那句「不要手改生成物」在这里的
     * 镜像：自动修也不许反过来改源）。 */
    expect(readFileSync(genAbs(), "utf8")).toContain("自动修探针：这一行只在编辑态。");
    expect(readFileSync(editAbs(), "utf8")).toBe(probed);
  });

  it("修不好时必须红：多余产物（源已不在 SCOPED_DOCS 里）不由重渲染收拾", () => {
    seedFixture();
    /* 「多余」的成因不是「忘了重渲染」，写入模式也不会删文件 —— 这一档必须把它
     * 如实报回来，而不是「跑过写入模式就当我赢了」。 */
    const orphan = join(fixtureRoot, "docs", "generated", "99-孤儿产物.md");
    writeFileSync(orphan, "# 自动修探针\n", "utf8");
    const { code, output } = runRender(["--check", "--autofix"]);
    expect(code, output).toBe(1);
    expect(output).toContain("重渲染之后仍不一致");
    expect(output).toContain("多余");
  });
});

/**
 * `--only`：只写点名那几份镜像（ISSUE #2527）。
 *
 * 这一格治的是**代改别人的**那个形状：写入档是**无条件**重生成所有镜像的，而 D0 那格
 * 「改了源就得带上镜像」逼人跑它 —— 于是「带上自己那一份」顺带把别人留在 HEAD 上的
 * 陈旧镜像一起改脏进自己这批（真仓库实测一例：改 1 份规范带出另一份镜像 126 行整表重排）。
 * 分得很开才谈得上处置：`--only` 答「我这批该写哪几份」，`--check` 答「全量漂了谁」。
 */
describe("doc:render 的 scoped 档（--only，ISSUE #2527）", () => {
  const RENDER = join(REPO_ROOT, "scripts", "render-doc-placeholders.cjs");
  const MINE = "docs/guides/DEV-QUERIES.md";
  const OTHERS = "docs/guides/TESTING.md";

  let fixtureRoot = "";
  const editAbs = (rel: string) => join(fixtureRoot, rel);
  const genAbs = (name: string) => join(fixtureRoot, "docs", "generated", name);

  function runRender(args: Array<string>): { code: number; output: string } {
    try {
      const output = execFileSync(process.execPath, [RENDER, ...args], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          DOC_RENDER_ROOT: fixtureRoot,
          DOC_RENDER_SCOPED: `${MINE},${OTHERS}`,
        },
      });
      return { code: 0, output };
    } catch (error) {
      /* SAFETY: 类型断言已复核 */
      const e = error as {
        status?: number;
        stderr?: string;
        stdout?: string;
      };
      return {
        code: typeof e.status === "number" ? e.status : 1,
        output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
      };
    }
  }

  /** 两份源 + 两份一致的镜像。 */
  function seedPair(): void {
    fixtureRoot = mkdtempSync(join(tmpdir(), "doc-render-only-"));
    for (const rel of [MINE, OTHERS]) {
      mkdirSync(dirname(editAbs(rel)), { recursive: true });
      writeFileSync(
        editAbs(rel),
        [
          `# ${rel}（夹具）`,
          "",
          "> **占位符约定**：占位符由 doc:check 动态核对。",
          "",
          "- ComfyUI 端口：{{comfyui.port}}",
          "",
        ].join("\n"),
        "utf8",
      );
    }
    const seeded = runRender([]);
    expect(seeded.code, seeded.output).toBe(0);
    expect(existsSync(genAbs("DEV-QUERIES.md")), seeded.output).toBe(true);
    expect(existsSync(genAbs("TESTING.md")), seeded.output).toBe(true);
  }

  afterEach(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
    fixtureRoot = "";
  });

  it("只写点名的那一份：别人留在镜像上的漂移一个字都不动", () => {
    seedPair();
    const STALE = "<!-- 别人留下的陈旧标记 -->";
    const othersBefore = `${readFileSync(genAbs("TESTING.md"), "utf8")}\n${STALE}\n`;
    writeFileSync(genAbs("TESTING.md"), othersBefore, "utf8");
    /* 自己的源也改一笔，让「该写」这件事真的成立（不然「没动」只是没活干）。 */
    const original = readFileSync(editAbs(MINE), "utf8");
    writeFileSync(
      editAbs(MINE),
      original.replace(
        "- ComfyUI 端口：{{comfyui.port}}",
        "- 探针：只写我自己那份。\n- ComfyUI 端口：{{comfyui.port}}",
      ),
      "utf8",
    );

    const { code, output } = runRender(["--only", MINE]);
    expect(code, output).toBe(0);
    expect(readFileSync(genAbs("DEV-QUERIES.md"), "utf8")).toContain("只写我自己那份");
    /* 本格的主断言：别人那份**没有被顺手重渲染**（内容逐字仍是脏的那版）。 */
    expect(readFileSync(genAbs("TESTING.md"), "utf8")).toBe(othersBefore);
    /* 降档要被念出来：这一批写了 1 份、全量是 2 份 —— 不写这行就成了「只跑了一遍渲染」
     * 而没人知道它跳过了几份（同 AGENTS 硬规则 7 那句「降档永远要被读出来」）。 */
    expect(output).toContain("全量是 2 份，这一批只写了 1 份");
  });

  it("漂了谁由 --check 点名：--only 之后仍如实报回别人那一格，且它一个字都不写", () => {
    seedPair();
    const stale = `${readFileSync(genAbs("TESTING.md"), "utf8")}\n<!-- 陈旧 -->\n`;
    writeFileSync(genAbs("TESTING.md"), stale, "utf8");
    expect(runRender(["--only", MINE]).code).toBe(0);
    const { code, output } = runRender(["--check"]);
    expect(code, output).not.toBe(0);
    expect(output).toContain("TESTING.md 落后于源");
    /* `--check` 那条路**只判不写**（写了就成了「没让人看见就代改了别人那份」——
     * 正是本单要分开的两个方向）。断言落在内容上，不落在那句**给人指路的**提示语上：
     * 报告里本来就该出现「重渲染」这个词，判它不许出现是我读错了判据。 */
    expect(readFileSync(genAbs("TESTING.md"), "utf8")).toBe(stale);
  });

  it("认不出的名字当场停，且一份都不写（否则「以为写了自己那份」与「什么都没写」同形）", () => {
    seedPair();
    const mineBefore = readFileSync(genAbs("DEV-QUERIES.md"), "utf8");
    const othersBefore = readFileSync(genAbs("TESTING.md"), "utf8");
    const { code, output } = runRender(["--only", "docs/guides/根本不存在.md"]);
    expect(code, output).toBe(1);
    expect(output).toContain("不在 SCOPED_DOCS 的名字");
    expect(readFileSync(genAbs("DEV-QUERIES.md"), "utf8")).toBe(mineBefore);
    expect(readFileSync(genAbs("TESTING.md"), "utf8")).toBe(othersBefore);
  });
});
