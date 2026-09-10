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
    const mod = (await import("../scripts/doc-facts.cjs")) as unknown as ScopeMod;
    return mod;
  }

  it("仓库当前不存在「未登记也未豁免」的规范文档（守卫基线为绿）", async () => {
    const { SCOPED_DOCS, SCOPED_DOC_DIRS, SCOPED_DOC_EXEMPTIONS } = await loadScope();
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
        if (!scoped.has(rel) && !(rel in SCOPED_DOC_EXEMPTIONS)) offenders.push(rel);
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
    // 必须被 main 调用，而不是只在文件里存在
    const mainBody = script.slice(script.indexOf("function main()"));
    expect(mainBody).toContain("checkScopeCoverage()");
  });
});

describe("台账命令口径守卫（AGENTS 硬规则 1：包管理只用 pnpm）", () => {
  /* 目的：文档里的 npm run / npx 不会编译报错，只会静静过期——复核全靠人肉逐行读。
   * 该守卫把「SCOPED_DOCS 里出现可执行 npm/npx 命令」变成硬错误，
   * 同时放行**说明性引用**（写出「改为/修正/pnpm」等纠正词的上下文）。 */

  it("已接入 main 流程（不是定义了却没人调用）", () => {
    const script = readFileSync(CHECK, "utf8");
    expect(script).toContain("function checkLedgerCommands()");
    const mainBody = script.slice(script.indexOf("function main()"));
    expect(mainBody).toContain("checkLedgerCommands()");
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
  function withRegisteredDocProbe(appended: string): { code: number; output: string } {
    const probe = "docs/guides/DEV-QUERIES.md";
    const original = readFileSync(join(REPO_ROOT, probe), "utf8");
    writeFileSync(join(REPO_ROOT, probe), `${original}\n${appended}\n`, "utf8");
    try {
      return runCheck();
    } finally {
      writeFileSync(join(REPO_ROOT, probe), original, "utf8");
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
