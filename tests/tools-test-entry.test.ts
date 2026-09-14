/**
 * tools/start/run-tests.ps1 的回归护栏：把「tools 里有没有能单独跑 vitest 的入口」
 * 这条约定机器化，避免它随重构悄悄消失（只跑测试的路径此前不存在，门禁脚本
 * verify-quality.ps1 只能三项串联整档跑）。
 *
 * 规范：docs/standards/11-测试与可观测性.md §11.12、launch-and-build.md §8
 *   - 入口只做「定位项目根 → 调用逻辑脚本 → 收尾」，逻辑在 scripts/ 下；
 *   - 参数要能透传给 vitest（指定单个文件 / 复现基线失败用 -Full）；
 *   - 已知基线失败清单只有一份来源（scripts/quality-gate.ps1），不许在两处各抄一份。
 *
 * 无 pwsh 的环境（Linux CI）只做文本与结构断言：入口/逻辑是否存在、参数是否透传、
 * 清单是否共用。真实执行在 Windows 侧。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ENTRY = join(process.cwd(), "tools", "start", "run-tests.ps1");
const LOGIC = join(process.cwd(), "scripts", "run-tests.ps1");
const GATE = join(process.cwd(), "scripts", "quality-gate.ps1");
const entry = readFileSync(ENTRY, "utf8");
const logic = readFileSync(LOGIC, "utf8");
const gate = readFileSync(GATE, "utf8");


describe("tools 里的 vitest 单跑入口", () => {
  it("入口与逻辑分层齐全（入口归 tools/start/，逻辑归 scripts/）", () => {
    // 规范 §8.2：双击入口在 tools/<分类>/，业务逻辑下沉到 scripts/
    expect(entry).toContain("scripts\\entry-common.ps1");
    expect(entry).toContain('"scripts\\run-tests.ps1"');
    expect(logic).toContain('@("exec", "vitest", "run")');
  });

  it("入口把参数与 -Full 开关透传给逻辑脚本", () => {
    // 少了透传就退化成「只能全量跑」，等于又把刚补的路径丢掉
    expect(entry).toContain("ValueFromRemainingArguments");
    expect(entry).toContain("-ScriptArgs $scriptArgs");
    expect(entry).toContain('$scriptArgs += "-Full"');
    expect(logic).toContain("ValueFromRemainingArguments");
  });

  it("透传参数时不再追加排除项", () => {
    // 传了具体文件还去 --exclude，会变成「我明明指定了它却不跑」
    const branch = logic.slice(
      logic.indexOf("if ($passthrough.Count -gt 0)"),
      logic.indexOf("$known = @(Get-KnownFailedFiles)"),
    );
    expect(branch).toContain("$vitestArgs += $passthrough");
    // 注释里提到 --exclude 说明「为何不排除」，别把说明文字当成实现在排除
    expect(branch).not.toMatch(/\$vitestArgs \+= @\("-\\-exclude"/);
  });

  it("已知基线失败清单只有一处来源：解析 quality-gate.ps1，不另抄一份", () => {
    // 两处各存一份清单，修好其中一个文件时只会在一处解禁，另一处继续静默跳过
    expect(logic).toContain("Get-KnownFailedFiles");
    expect(logic).toMatch(/quality-gate\.ps1/);
    expect(logic).not.toContain('"src/server/api/routers/task.test.ts"');
    expect(logic).not.toContain('"src/server/api/routers/generate.test.ts"');
    // 被解析的那份声明必须真实存在，否则解析恒为空、排除悄悄失效
    expect(gate).toContain("$KNOWN_FAILED_FILES = @(");
  });

  it("排除参数拼装与门禁共用同一份实现（Get-VitestKnownFailureArgs）", () => {
    expect(gate).toContain("function Get-VitestKnownFailureArgs");
    expect(gate).toContain("$argsAll += @(Get-VitestKnownFailureArgs)");
  });

  it("-Full 保留基线失败文件，默认才排除", () => {
    const fullBranch = logic.slice(
      logic.indexOf("if ($Full)"),
      logic.indexOf("# ── 4)"),
    );
    expect(fullBranch).toContain("已知基线失败文件一并运行");
    // -Full 分支只打印说明，不追加排除参数
    expect(fullBranch).not.toMatch(/\$vitestArgs \+= @\("-\\-exclude"/);
  });

  it("含中文的 .ps1 以 UTF-8 BOM 保存（R8，否则 PS 5.1 按 GBK 解码）", () => {
    for (const abs of [ENTRY, LOGIC]) {
      const buf = readFileSync(abs);
      expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]);
    }
  });

  it("缺失依赖时给出可照做的中文提示，而不是 vitest 的解析报错", () => {
    expect(logic).toContain("node_modules\\.bin");
    expect(logic).toContain("pnpm install");
  });
});

/**
 * 跨平台一致性：端口推导对同一输入必须给出同一端口。CI 是 Linux、开发者是
 * Windows，"F:/…" 这类盘符路径若交给平台相关的 path.resolve，在 POSIX 上会被
 * 拼到 cwd 前面，同一检出算出两个端口（多检出并行的前提当场失效）。
 * 这里按语言无关的方式锁住：把 four-way 锚点 f:/ai/other/comfy-app-t3-branch
 * 的推导结果钉死（PowerShell / Python / Rust 侧写的是同一个值）。
 */
describe("app-port 跨平台一致性", () => {
  const MJS = readFileSync(join(process.cwd(), "scripts", "app-port.mjs"), "utf8");

  it("盘符路径不喂给平台相关的 path.resolve", () => {
    expect(MJS).toContain("isWindowsDrive");
    // 判据本体在源码里写作 /^[a-z]:\//i，这里按字符串比对避免多层正则转义失真
    expect(MJS).toContain("/^[a-z]:\\//i");
  });

  it("盘符路径（Windows 写法）与正斜杠写法推导出同一端口，且与四侧锚点一致", async () => {
    // 锚点 3305 / fnv 0x97ecb3a9 由 node 生成并被 PowerShell / Python / Rust 侧
    // 引用；这条断言在 Linux（CI）上同样成立，正是跨平台修复的意义所在。
    const { derivePortFromPath } = (await import("../scripts/app-port.mjs")) as {
      derivePortFromPath: (root: string) => number;
    };
    expect(derivePortFromPath("F:\\AI\\Other\\comfy-app-t3-branch")).toBe(3305);
    expect(derivePortFromPath("F:/AI/Other/comfy-app-t3-branch")).toBe(3305);
    expect(derivePortFromPath("F:\\AI\\Other\\comfy-app-t3-branch2")).not.toBe(3305);
  });
});
