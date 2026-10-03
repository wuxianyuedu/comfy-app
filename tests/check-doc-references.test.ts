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
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const CHECK = join(REPO_ROOT, "scripts", "check-doc-references.cjs");

/** 把脚本真正引入的内存态 FACTS 拿来做结构断言（与脚本同源，见 doc-facts.cjs）。 */
type Fact = {
  key: string;
  kind: string;
  placeholder?: string;
  onlyDocs?: string[];
  otherDocs?: string[];
  extract: () => unknown;
};

async function loadFacts(): Promise<Fact[]> {
  const mod = (await import("../scripts/doc-facts.cjs")) as unknown as {
    FACTS: Fact[];
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
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

const docText = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

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
      if (readFileSync(abs, "utf8") === text) return;
      lastError = "写回后读回的内容与预期不一致";
    } catch (err) {
      lastError = (err as Error).message;
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
 * 「这条判据真的被 `main()` 调用了吗」—— 不能用 `toContain(调用文本)`。
 * 把那一行前面加 `// ` 注掉，行里仍含同一段字面量，`toContain` 照样命中（实测：
 * 本文件里四处「已接入 main 流程」的老写法第一次变异全都绿着放过，ISSUE #1374）。
 * 这里要求它是一行**独立语句**：行首只有缩进、结尾是分号。
 */
function isCalledInMain(script: string, call: string): boolean {
  const mainBody = script.slice(script.indexOf("function main()"));
  const escaped = call.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    expect(fact?.otherDocs).toContain(
      "docs/standards/Comfy-APP-T3-项目开发规范.md",
    );
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
    expect(docText("docs/generated/Comfy-APP-T3-项目开发规范.md")).toContain(
      ":8188`",
    );
  });
});

describe("校验范围守卫（SCOPED_DOC_DIRS / SCOPED_DOC_EXEMPTIONS）", () => {
  /* 守卫的目的：让「新增规范文档忘了登记 → doc:check 静默跳过它」变成硬错误。
   * 此前 `doc:check` 只校验 SCOPED_DOCS 里列出的文档，未登记的新文档写死
   * 过期端口也没人报错——「全量纳管」只是人工承诺。 */

  type ScopeMod = {
    SCOPED_DOCS: string[];
    SCOPED_DOC_DIRS: string[];
    SCOPED_DOC_EXEMPTIONS: Record<string, string>;
  };

  async function loadScope(): Promise<ScopeMod> {
    const mod =
      (await import("../scripts/doc-facts.cjs")) as unknown as ScopeMod;
    return mod;
  }

  it("仓库当前不存在「未登记也未豁免」的规范文档（守卫基线为绿）", async () => {
    const { SCOPED_DOCS, SCOPED_DOC_DIRS, SCOPED_DOC_EXEMPTIONS } =
      await loadScope();
    expect(SCOPED_DOC_DIRS.length).toBeGreaterThan(0);
    const scoped = new Set(SCOPED_DOCS);
    const { readdirSync, statSync } = await import("node:fs");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(REPO_ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(REPO_ROOT, rel)).isDirectory()) {
          walk(rel);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        if (!scoped.has(rel) && !(rel in SCOPED_DOC_EXEMPTIONS))
          offenders.push(rel);
      }
    };
    SCOPED_DOC_DIRS.forEach(walk);
    expect(offenders).toEqual([]);
  });

  it("新增一个未登记的规范文档 → doc:check 失败并点名该文件", () => {
    const temp = join(
      REPO_ROOT,
      "docs",
      "standards",
      "99-temp-unregistered.md",
    );
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
        if (!/(^|[\s`(（])(npm\s+run|npx)\b/.test(line)) return;
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
    const { code, output } = withRegisteredDocProbe(
      "```bash\nnpm run test:e2e\n```",
    );
    expect(code).not.toBe(0);
    expect(output).toContain("DEV-QUERIES.md");
    expect(output).toContain("硬规则 1");
    expect(output).toContain("pnpm");
  });

  it("npx 同样被拦下", () => {
    const { code, output } = withRegisteredDocProbe(
      "```bash\nnpx tsc --noEmit\n```",
    );
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
    const mod = (await import("../scripts/doc-facts.cjs")) as unknown as {
      SCOPED_DOCS: string[];
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
    expect(ledgerBody).toMatch(
      /\[\s*AGENTS_MD_PATH\s*,\s*\.\.\.SCOPED_DOCS\s*\]/,
    );
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
  const EXPLAIN_RE =
    /不写|别再|不要写|禁止|应写|应改|一律|改成|序号|没有唯一|已删|已随|历史/;

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

  /** 扫描面与判据同源：AGENTS.md + 两份索引 + SCOPED_DOCS。 */
  async function gateDocs(): Promise<string[]> {
    const mod = (await import("../scripts/doc-facts.cjs")) as unknown as {
      SCOPED_DOCS: string[];
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

  it("已接入 main 流程（不是定义了却没人调用）", () => {
    const script = readFileSync(CHECK, "utf8");
    expect(script).toContain("function checkGateStepIndexRefs()");
    expect(isCalledInMain(script, "checkGateStepIndexRefs()")).toBe(true);
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
      if (!existsSync(join(REPO_ROOT, doc))) continue;
      scanned += 1;
      docText(doc)
        .split("\n")
        .forEach((line, i) => {
          if (!STEP_RE.test(line) || !GATE_RE.test(line)) return;
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
    const { code, output } = withProbe(
      "AGENTS.md",
      "临时探针：门禁见 pre-commit 第 98 步。",
    );
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
  function hookCommands(): string[] {
    const text = docText(HOOK_REL);
    return [...text.matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) =>
      (m[2] ?? "").replace(/\s+/g, " ").trim(),
    );
  }
  function docCommands(): string[] {
    const text = docText(DOC_REL);
    const start = text.indexOf(CHECKLIST_MARKER);
    const rest = text.slice(start);
    const close = rest.indexOf("```");
    expect(
      start,
      "§13.1 的 marker 还在吗？判据与这条用例都要靠它定位",
    ).toBeGreaterThan(-1);
    expect(close, "marker 之后找不到围栏收尾").toBeGreaterThan(-1);
    return rest
      .slice(0, close)
      .split("\n")
      .filter((l) => l.startsWith("✅ "))
      .map((l) =>
        (l.slice(2).split(/ +# /)[0] ?? "").replace(/\s+/g, " ").trim(),
      );
  }

  /** 精确替换一次：命中 0 次或 ≥2 次都直接抛 —— 否则文档一改措辞，探针就静默失效，
   *  用例得到「意外绿」，而这正是本刀要拦的那个形状。 */
  function replaceOnce(text: string, from: string, to: string): string {
    const hits = text.split(from).length - 1;
    if (hits !== 1) {
      throw new Error(
        `探针锚点命中 ${hits} 次（应为 1）：${from.slice(0, 60)}`,
      );
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
    const script = readFileSync(CHECK, "utf8");
    expect(script).toContain("function checkGateChecklistMatchesHook()");
    expect(isCalledInMain(script, "checkGateChecklistMatchesHook()")).toBe(
      true,
    );
  });

  it("量具自己没坏：注释掉的调用不算「已接入」", () => {
    const wired = "function main() {\n  checkGateChecklistMatchesHook();\n}\n";
    const muted =
      "function main() {\n  // checkGateChecklistMatchesHook();\n}\n";
    expect(isCalledInMain(wired, "checkGateChecklistMatchesHook()")).toBe(true);
    expect(isCalledInMain(muted, "checkGateChecklistMatchesHook()")).toBe(
      false,
    );
  });

  it("存量 = 0：钩子 D 组的每一步都在清单里，且 flag 逐字一致", () => {
    const hook = hookCommands();
    const doc = new Set(docCommands());
    expect(
      hook.length,
      "解析不出钩子步骤，这条用例等于什么都没测",
    ).toBeGreaterThanOrEqual(25);
    for (const cmd of hook) {
      expect(doc.has(cmd), `清单里缺这一条（或 flag 不一致）：${cmd}`).toBe(
        true,
      );
    }
  });

  it("把清单里那一步的 --strict 抹掉 → 红，并点名是哪一步", () => {
    // 这一条就是本刀的现场：文档写 `check-file-structure.cjs`、钩子跑带 --strict 的那一档。
    const { code, output } = withDocProbe(() => {
      const abs = join(REPO_ROOT, DOC_REL);
      writeText(
        abs,
        replaceOnce(
          readFileSync(abs, "utf8"),
          "✅ node scripts/check-file-structure.cjs --strict",
          "✅ node scripts/check-file-structure.cjs",
        ),
      );
    });
    expect(code).not.toBe(0);
    expect(output).toContain("node scripts/check-file-structure.cjs --strict");
    expect(output).toContain("flag 与钩子不一致");
  });

  it("清单漏登记一步（新增判据忘了同步）→ 红", () => {
    const { code, output } = withDocProbe(() => {
      const abs = join(REPO_ROOT, DOC_REL);
      writeText(
        abs,
        replaceOnce(
          readFileSync(abs, "utf8"),
          "✅ node scripts/check-title-bar-clearance.cjs\n",
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
          "✅ node scripts/check-void-floats.cjs",
          "✅ node scripts/zz-pretend-judge.cjs\n✅ node scripts/check-void-floats.cjs",
        ),
      );
    });
    expect(code).not.toBe(0);
    expect(output).toContain("node scripts/zz-pretend-judge.cjs");
    expect(output).toContain("的 D 组没有这一步");
  });
});
