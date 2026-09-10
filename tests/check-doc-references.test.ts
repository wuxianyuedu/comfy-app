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
import { readFileSync } from "node:fs";
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
