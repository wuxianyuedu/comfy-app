/**
 * 提交门槛自检：把 scripts/check-file-structure.cjs 当成黑盒跑在临时工作区上，
 * 验证「Windows 入口 .ps1 化」这条硬规则（R7/R8，ISSUE #23）真的会阻断提交，
 * 而不是只写在文档里。
 *
 * 规范：docs/standards/launch-and-build.md §8
 *   - R7 仓库内禁止 .bat / .cmd / .vbs 入口（历史惨案：cmd 走 GBK 代码页，
 *     中文提示与子进程 UTF-8 输出必然乱码，入口被迫做成不含中文的哑壳）
 *   - R8 scripts/ tools/ 下含中文的 .ps1 必须 UTF-8 BOM（无 BOM 会被 PS 5.1
 *     按 GBK 解码，与 .bat 乱码同源）
 *   - R9 根目录禁止散落 .ps1 双击入口（ISSUE #29）：入口归入 tools/<分类>/，
 *     启动类归 tools/start/；根目录只留工程配置
 *   - R10 注释里禁止「历史流水」（日期 / 改动编号 / 任务批次号，ISSUE #46）：
 *     作者与修改日期归 git log，写进注释会随代码搬迁过期失真
 *   - R11 Next 16 起代理约定名是 src/proxy.ts（`middleware` 已废弃，ISSUE #489）：
 *     文件被删 / 改回旧名 / 挪离 src 根都阻断
 *   - R12 src/ 源码禁止内嵌控制字符（NUL 等，规范 §12.11）：带 NUL 的文件会被
 *     git / diff / grep / 编辑器判成二进制，改动从此无法 Review
 *   - R5 超 900 行的文件进拆分候选（只提醒不阻断）：扫描范围是**整个 `src/`**、
 *     不分层不分文件类型；只扫 `src/components/`（历史口径）会让最大的那个文件
 *     与逻辑层的大文件都不设防（ISSUE #536）
 *
 * 为什么用子进程跑而不是 import：该脚本被 pre-commit 以 `node scripts/xxx.cjs`
 * 调用，且内部用 process.cwd() 定位扫描根；复用同一调用方式才等价于真实门禁。
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-file-structure.cjs");
// 构建前置守卫：断言它真的能认出「路径落在本仓库 src-tauri\target\ 下的 app.exe」，
// 而不是把同名的无关进程（如别处的 app.exe）当成目标壳误杀。
const GUARD = join(process.cwd(), "tools", "scripts", "Build-Guard.ps1");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

let workdir = "";

function run(): { code: number; output: string } {
  return runWith([]);
}

/** 带参数的调用：R5 的棘轮只在 `--strict` 下判定（规范 §18.5）。 */
function runWith(args: string[]): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "check-file-structure.cjs"), ...args],
      { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "structure-gate-"));
  copyFileSync(SCRIPT, join(workdir, "check-file-structure.cjs"));
  // 脚本无条件扫描 src/（R1-R6 规则），临时工作区必须存在该目录
  mkdirSync(join(workdir, "src"));
  mkdirSync(join(workdir, "scripts"));
  mkdirSync(join(workdir, "tools", "build"), { recursive: true });
  /* R13 的默认前提：src/lib 存在（判据只看它的顶层条目）。临时工作区不带它时
   * R13 整块跳过 —— 那些 R5 棘轮用例要的是「无 R13 噪声」，所以这里把目录建出来，
   * 不往里放任何东西（空目录既不违反 R13，也不触发 R14）。 */
  mkdirSync(join(workdir, "src", "lib"), { recursive: true });
  /* R11 的默认前提：Next 16 代理约定文件在 src/ 根。真实仓库里它一直在，
   * 所以「干净工作区放行」这类基线用例必须带上它，否则测的不是真实形态。 */
  writeFileSync(
    join(workdir, "src", "proxy.ts"),
    "export function proxy() {}\n",
  );
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("check-file-structure.cjs（提交门槛）", () => {
  it("干净的工作区放行", () => {
    writeFileSync(
      join(workdir, "scripts", "ok.ps1"),
      Buffer.concat([BOM, Buffer.from('Write-Host "中文提示"\n')]),
    );
    const { code, output } = run();
    expect(output).toContain("[structure] OK");
    expect(code).toBe(0);
  });

  it("R9：根目录新增 .ps1 双击入口被阻断（ISSUE #29）", () => {
    writeFileSync(
      join(workdir, "start-web.ps1"),
      Buffer.concat([BOM, Buffer.from('Write-Host "启动"\n')]),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("R9");
    expect(output).toContain("start-web.ps1");
  });

  it("R9：tools/start/ 下的入口放行（入口归位不误伤）", () => {
    mkdirSync(join(workdir, "tools", "start"), { recursive: true });
    writeFileSync(
      join(workdir, "tools", "start", "start-web.ps1"),
      Buffer.concat([BOM, Buffer.from('Write-Host "启动"\n')]),
    );
    const { code, output } = run();
    expect(output).toContain("[structure] OK");
    expect(code).toBe(0);
  });

  it("R9：根目录的非 .ps1 文件不受约束（配置/文档照旧）", () => {
    // R9 只针对双击入口，不收紧根目录的工程配置与文档
    writeFileSync(join(workdir, "package.json"), "{}\n");
    writeFileSync(join(workdir, "README.md"), "# demo\n");
    const { code, output } = run();
    expect(output).toContain("[structure] OK");
    expect(code).toBe(0);
  });

  it("R7：新增 .bat 入口被阻断", () => {
    writeFileSync(join(workdir, "scripts", "foo.bat"), "@echo off\r\n");
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("R7");
    expect(output).toContain("scripts/foo.bat");
  });

  it("R7：.cmd 与 .vbs 同样被阻断", () => {
    writeFileSync(join(workdir, "tools", "b.cmd"), "@echo off\r\n");
    writeFileSync(join(workdir, "start-tauri.vbs"), "WScript.Quit\r\n");
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("tools/b.cmd");
    expect(output).toContain("start-tauri.vbs");
  });

  it("R8：含中文但无 BOM 的 .ps1 被阻断", () => {
    writeFileSync(
      join(workdir, "tools", "build", "bad.ps1"),
      'Write-Host "中文提示"\n',
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("R8");
    expect(output).toContain("tools/build/bad.ps1");
  });

  it("R8：纯 ASCII 的 .ps1 不强制 BOM（不制造无谓噪音）", () => {
    writeFileSync(
      join(workdir, "tools", "build", "ascii.ps1"),
      'Write-Host "hello"\n',
    );
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).not.toContain("R8");
  });

  it("R8：带 BOM 的中文 .ps1 放行", () => {
    const content = Buffer.concat([
      BOM,
      Buffer.from('Write-Host "桌面版自检"\n'),
    ]);
    writeFileSync(join(workdir, "tools", "build", "good.ps1"), content);
    const { code } = run();
    expect(code).toBe(0);
  });

  // ── R10：注释里的「历史流水」(ISSUE #46 / 规范 12.4.2 / 反模式表 G4) ──
  // 三类标记都是「哪一批改动留下的」，git log 天然可查，写进注释会随代码
  // 搬迁过期失真（改过一次的代码上仍挂着三个月前的编号）。
  describe("R10：注释里的历史流水被阻断（ISSUE #46）", () => {
    const writeSrc = (name: string, body: string) => {
      mkdirSync(join(workdir, "src"), { recursive: true });
      writeFileSync(join(workdir, "src", name), body);
    };

    it("改动编号 R-ardot114 被阻断", () => {
      writeSrc(
        "a.ts",
        "// R-ardot114 (2026-08-17): SSE 心跳\nexport const a = 1;\n",
      );
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R10");
      expect(output).toContain("R-ardot114");
    });

    it("短编号 R83 与批次号 T12-3 被阻断", () => {
      writeSrc(
        "b.ts",
        "/* 2026-08-13 R83: 失败面板 */\n/* T12-3 抽离 */\nexport const b = 2;\n",
      );
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R83");
      expect(output).toContain("T12-3");
    });

    it("只写当前 Why（无日期无编号）的注释放行", () => {
      writeSrc(
        "c.ts",
        "// SSE 心跳：防止 Nginx 60s 空闲断开。\nexport const c = 3;\n",
      );
      const { code } = run();
      expect(code).toBe(0);
    });

    it("代码里的日期字面量不属于注释流水，放行", () => {
      writeSrc(
        "d.ts",
        'export const SINCE = "2026-08-17";\nexport const KEY = `wfdetail:R6:v2`;\n',
      );
      const { code } = run();
      expect(code).toBe(0);
    });

    it("样式文件（.css）里的流水注释同样被阻断", () => {
      /* 只扫 TS 时 `.css` 是盲区，而样式块恰恰常被整段搬运 —— 收口前
         globals.css 里就有三处（编号 T10 / T11）长期未被发现。 */
      mkdirSync(join(workdir, "src", "app"), { recursive: true });
      writeFileSync(
        join(workdir, "src", "app", "globals.css"),
        "/* 沉浸式表面 — T11 */\n.a { color: red; }\n",
      );
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R10");
      expect(output).toContain("globals.css");
    });

    it("样式文件里只写当前 Why 的注释放行", () => {
      mkdirSync(join(workdir, "src", "app"), { recursive: true });
      writeFileSync(
        join(workdir, "src", "app", "globals.css"),
        "/* 滚动条外观的唯一出口：三档取值各有出处 */\n.a { color: red; }\n",
      );
      const { code } = run();
      expect(code).toBe(0);
    });
  });

  // ── R11：Next 16 起代理约定名是 proxy（`middleware` 已废弃，ISSUE #489）──
  // 删文件与改回旧名都会「消掉警告」，但代价是代理落点一起消失 / 警告回流，
  // 所以两条都要在提交阶段拦下，而不是等构建期那条 deprecation 提示。
  describe("R11：Next 16 代理约定（ISSUE #489）", () => {
    const writeProxy = (rel: string) => {
      const abs = join(workdir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, "export function proxy() {}\n");
    };

    it("src/proxy.ts 存在时放行（约定名不被 R2 kebab 规则误伤）", () => {
      writeProxy("src/proxy.ts");
      const { code, output } = run();
      expect(code).toBe(0);
      expect(output).not.toContain("R2");
    });

    it("缺少 src/proxy.ts 时阻断（代理落点被删，构建期不报错）", () => {
      rmSync(join(workdir, "src", "proxy.ts"));
      //（外层的 beforeEach 已建好该文件，这里模拟「被删掉」）
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R11");
    });

    it("改回 src/middleware.ts 时阻断（Next 16 已废弃的约定名）", () => {
      writeProxy("src/middleware.ts");
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R11");
    });

    it("约定文件被挪离 src/ 根时阻断（Next 不会加载，静默失效）", () => {
      writeProxy("src/app/proxy.ts");
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R11");
    });
  });

  // ── R12：src/ 源码里不得内嵌控制字符（规范 §12.11）──
  // 判据来自一次真实事故：`lib/comfyui/markdown.ts` 曾用真的 NUL 字节做占位符
  // 哨兵（`\0CODE<n>\0`），于是整个文件被 git / diff / grep / 编辑器当二进制：
  // `git diff` 只回「Binary files differ」、`git show --stat` 显示 bin、
  // `grep -rn` 静默跳过。哨兵改成可打印形式后，这条规则负责防回潮。
  describe("R12：源码内嵌控制字符被阻断（规范 §12.11）", () => {
    /* NUL 只能用**转义**写进用例源码——直接嵌一个真字节会把本测试文件自己也
     * 变成二进制（正是 R12 要拦的形态）。写进临时文件时才还原成真字节。 */
    const NUL = "\u0000";
    const writeSrc = (name: string, body: string) => {
      mkdirSync(join(workdir, "src"), { recursive: true });
      writeFileSync(join(workdir, "src", name), body);
    };

    it("内嵌 NUL 字节被阻断", () => {
      writeSrc(
        "a.ts",
        'export const SENTINEL = "' + NUL + "CODE0" + NUL + '";\n',
      );
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R12");
      expect(output).toContain("NUL");
    });

    it("制表符 / 换行 / 回车属于正常排版，放行", () => {
      writeSrc("b.ts", "export const a = 1;\r\n\tconst b = 2;\n");
      const { code, output } = run();
      expect(code).toBe(0);
      expect(output).not.toContain("R12");
    });

    it("正文里的**转义写法** `\\u0000` 是普通字符，放行", () => {
      // 关键区分：源码里写的是 6 个可见字符（反斜杠 + u0000），
      // 不是一个控制字节。要常量本身带 NUL 的场合（如果真有）才需要它，
      // 而那时文件依然是纯文本，git 与 grep 都读得动。
      writeSrc("c.ts", 'export const ESCAPED = "\\u0000";\n');
      const { code, output } = run();
      expect(code).toBe(0);
      expect(output).not.toContain("R12");
    });

    it("普通注释里的中文与 emoji 不是控制字符，放行", () => {
      writeSrc(
        "d.ts",
        "// 哨兵 → 用可打印形式，别用真的 NUL 字节 ✅\nexport const d = 4;\n",
      );
      const { code, output } = run();
      expect(code).toBe(0);
      expect(output).not.toContain("R12");
    });
  });

  /* ── R13/R14：src/lib 的域归属纪律（ISSUE #565 / 规范 §12.5.3）──
   *
   * 这两条的价值全在「新增模块会被要求先回答归属」——而它们最容易的失效方式
   * 是「判定永远为绿」（比如只看目录名、不递归看顶层文件）。因此这里既测
   * 「该拦的拦」，也测「豁免清单里的单例不被误伤」，还把「域目录名未登记」
   * 单独钉住：漏登记会让 R13 的归属判据形同虚设。 */
  describe("R13/R14：src/lib 子域纪律（规范 §12.5.3）", () => {
    const writeLib = (rel: string, body = "export const x = 1;\n") => {
      const abs = join(workdir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    };

    it("根目录散放的普通模块被阻断", () => {
      writeLib("src/lib/orphaned-helper.ts");
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R13");
      expect(output).toContain("src/lib/orphaned-helper.ts");
    });

    it("归入已登记子域后放行", () => {
      writeLib("src/lib/media/size-presets.ts");
      const { code, output } = run();
      expect(output).not.toContain("R13");
      expect(code).toBe(0);
    });

    it("未登记的子域目录被阻断（新增域要同时登记 DOMAINS 与覆盖率门槛）", () => {
      writeLib("src/lib/brand-new-domain/a.ts");
      const { code, output } = run();
      expect(code).toBe(1);
      expect(output).toContain("R14");
      expect(output).toContain("brand-new-domain");
    });

    it("根目录的测试伙伴文件跟着被测模块走（不因用例单独散放而红）", () => {
      writeLib("src/lib/utils.test.ts");
      const { code, output } = run();
      expect(output).not.toContain("R13");
      expect(code).toBe(0);
    });
  });

  // ── R5：超大文件的拆分候选（提示级，ISSUE #536）──
  // 历史口径只扫 `src/components/` 且只认 .tsx，于是**全仓库最大的那个文件**
  //（`settings/SettingsPageView.tsx` 2499 行）与逻辑层的大文件
  //（`lib/comfyui/lifecycle.ts` 1041 行）都不在任何护栏里。这里把范围钉死：
  // 整个 `src/`、不分层不分文件类型。只提醒不阻断。
  //（ISSUE #535 曾只把 `src/app` 补进目录维度；本块是那次评估的收敛版，
  //  目录维度与文件类型维度一起放开。）
  describe("R5：拆分候选覆盖整个 src/（ISSUE #536）", () => {
    /** 造一个恰好 `lines` 行的源文件。 */
    const writeLines = (rel: string, lines: number) => {
      const abs = join(workdir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(
        abs,
        Array.from({ length: lines }, () => "// x").join("\n"),
      );
    };

    it("src/app 下的超长视图进入提醒（只提示不阻断）", () => {
      writeLines("src/app/(main)/settings/SettingsPageView.tsx", 901);
      const { code, output } = run();
      expect(code).toBe(0); // 提醒不得升级为阻断
      expect(output).toContain("拆分候选");
      expect(output).toContain("src/app/(main)/settings/SettingsPageView.tsx");
    });

    it("src/lib 下的超长逻辑模块同样进入提醒（不再只管 .tsx）", () => {
      writeLines("src/lib/comfyui/lifecycle.ts", 901);
      const { code, output } = run();
      expect(code).toBe(0);
      expect(output).toContain("src/lib/comfyui/lifecycle.ts");
    });

    it("src/components 下的超长文件照旧提醒（不因扩范围而丢）", () => {
      writeLines("src/components/studio/logs/LogPanel.tsx", 901);
      const { code, output } = run();
      expect(code).toBe(0);
      expect(output).toContain("src/components/studio/logs/LogPanel.tsx");
    });

    it("刚好 900 行不算超阈值（不多报噪音）", () => {
      writeLines("src/app/(main)/settings/SettingsPageView.tsx", 900);
      const { code, output } = run();
      expect(code).toBe(0);
      expect(output).not.toContain("拆分候选");
    });

    it("测试文件不进拆分候选（用例体量不是可维护性信号）", () => {
      writeLines(
        "src/app/(main)/settings/hooks/use-settings-page.test.ts",
        901,
      );
      const { code, output } = run();
      expect(code).toBe(0);
      expect(output).not.toContain("拆分候选");
    });
  });

  // ── R5 棘轮（ISSUE #575 第 8 项 / 规范 §18.5）──
  // 「只提醒」挡不住新增长文件：提醒是输出里的一行字，没有人会因为一行提示
  // 去拆文件 —— 本项目 900 行以上的文件长期停在 10 个、只增不减。这里把
  // 「存量交给排期、增量交给棘轮」这条口径机器化。
  describe("R5 棘轮：超 900 行文件只许降不许升（--strict）", () => {
    const writeLines = (rel: string, lines: number) => {
      const abs = join(workdir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(
        abs,
        Array.from({ length: lines }, () => "// x").join("\n"),
      );
    };
    /* 写基线（键为仓库相对路径，值为行数）。
     * 路径与脚本同级 —— 本测试把脚本**拷到工作区根**（`__dirname` = 工作区根），
     * 真实仓库里它住在 `scripts/`，两者的相对关系（基线在脚本旁边）一致。 */
    const BASELINE = () => join(workdir, ".file-size-baseline.json");
    const writeBaseline = (files: Record<string, number>) => {
      writeFileSync(
        BASELINE(),
        JSON.stringify(
          { threshold: 900, total: Object.keys(files).length, files },
          null,
          2,
        ),
      );
    };

    it("基线缺失时 --strict 阻断并给出可行动作", () => {
      writeLines("src/lib/media/huge.ts", 1000);
      const { code, output } = runWith(["--strict"]);
      expect(code).toBe(1);
      expect(output).toContain("R5 基线文件缺失");
      expect(output).toContain("--update");
    });

    it("基线内的超限文件放行（存量交给排期）", () => {
      writeLines("src/lib/media/huge.ts", 1000);
      writeBaseline({ "src/lib/media/huge.ts": 1000 });
      const { code, output } = runWith(["--strict"]);
      expect(code).toBe(0);
      expect(output).toContain("[structure] OK");
    });

    it("新增超限文件被阻断（这才是棘轮的意义）", () => {
      writeLines("src/lib/media/huge.ts", 1000);
      writeBaseline({ "src/lib/media/huge.ts": 1000 });
      writeLines("src/lib/media/another-huge.ts", 950);
      const { code, output } = runWith(["--strict"]);
      expect(code).toBe(1);
      expect(output).toContain("R5 新增超限文件");
      expect(output).toContain("src/lib/media/another-huge.ts");
    });

    it("存量文件继续变大同样阻断（不是「进过基线就永久免疫」）", () => {
      writeLines("src/lib/media/huge.ts", 1000);
      writeBaseline({ "src/lib/media/huge.ts": 1000 });
      writeLines("src/lib/media/huge.ts", 1200);
      const { code, output } = runWith(["--strict"]);
      expect(code).toBe(1);
      expect(output).toContain("R5 超限文件继续变大");
    });

    it("降回阈值内后提示收紧基线（不阻断，避免打断提交）", () => {
      writeLines("src/lib/media/shrunk.ts", 800);
      writeBaseline({ "src/lib/media/shrunk.ts": 1000 });
      const { code, output } = runWith(["--strict"]);
      expect(code).toBe(0);
      expect(output).toContain("R5 基线可收紧");
    });

    it("非 strict（pre-commit 口径）不因新增超限文件阻断", () => {
      writeLines("src/lib/media/huge.ts", 1000);
      writeBaseline({});
      const { code } = run();
      expect(code).toBe(0);
    });

    it("--update 按当前扫描重写基线（治理后收紧）", () => {
      writeLines("src/lib/media/huge.ts", 1000);
      writeBaseline({ "src/lib/stale.ts": 1234 });
      const { code, output } = runWith(["--update"]);
      expect(code).toBe(0);
      expect(output).toContain("R5 基线已更新");
      const written = JSON.parse(readFileSync(BASELINE(), "utf8")) as {
        files: Record<string, number>;
      };
      expect(written.files).toEqual({ "src/lib/media/huge.ts": 1000 });
    });

    /* ── 行数按 baselineRev 同口径重数（ISSUE #637）──
     * 现场：`LogPanel.tsx` 的基线 1102 记于全库 prettier 治理**之前**；治理后同一
     * 文件（一个字没改）已是 1236 行。此后任何人**一行都不碰它**，CI 也报
     * 「R5 超限文件继续变大（1102 → 1236）」—— 棘轮把「格式口径变化」读成了
     * 「这次改动让文件变大」，而作者无从下手。
     *
     * 修法：基线自带记它那一刻的 `baselineRev`，比对前按**今天的计数口径**重数
     * 基线版本的内容 —— 判据变成「这个文件在**同口径**下比基线那一刻多没多」。
     * 下面用真 git 仓库造出「基线版本」与「当前」两态。 */
    describe("R5 行数口径随 baselineRev 重数（ISSUE #637）", () => {
      const git = (...args: string[]) => {
        execFileSync("git", args, { cwd: workdir, stdio: "ignore" });
      };
      const writeBaselineAtRev = (
        files: Record<string, number>,
        rev: string,
      ) => {
        writeFileSync(
          BASELINE(),
          JSON.stringify(
            {
              threshold: 900,
              ruleVersion: 3,
              baselineRev: rev,
              total: Object.keys(files).length,
              files,
            },
            null,
            2,
          ),
        );
      };
      const head = () =>
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: workdir,
          encoding: "utf8",
        }).trim();
      /** 造一个「基线那一刻」的提交，返回它的修订号。 */
      const commitAs = (rel: string, lines: number, message: string) => {
        writeLines(rel, lines);
        git("add", "-A");
        git("commit", "-qm", message);
        return head();
      };

      /* 脚本要 `git show <rev>:<file>` 取基线版本内容，故逐条自建仓库；
       * `workdir` 由 beforeEach 给出。 */
      beforeEach(() => {
        git("init", "-q");
        git("config", "user.email", "t@example.com");
        git("config", "user.name", "t");
        git("config", "commit.gpgsign", "false");
      });

      it("基线数字记少了、内容未变 → 按同口径重数后放行（不误报）", () => {
        /* 基线那一刻文件是 1000 行，但基线里记成 900（旧口径 / 手工记漏）。
         * 旧判据会拿 1000 > 900 直接判「这次改动让它变大」—— 而当前 1000 行与
         * 基线版本逐行相同，压根没人动过它。 */
        const rev = commitAs("src/lib/media/huge.ts", 1000, "baseline");
        writeBaselineAtRev({ "src/lib/media/huge.ts": 900 }, rev);

        const { code, output } = runWith(["--strict"]);
        expect(code).toBe(0);
        expect(output).toContain("[structure] OK");
      });

      it("内容未变 → 放行；再真加 20 行 → 阻断（同口径比较不放过真实膨胀）", () => {
        const rev = commitAs("src/lib/media/huge.ts", 1000, "baseline");
        writeBaselineAtRev({ "src/lib/media/huge.ts": 900 }, rev);
        /* ① 一个字没改：同口径重数得 1000，与当前 1000 持平 → 放行。 */
        expect(runWith(["--strict"]).code).toBe(0);
        /* ② 真加了 20 行：1000 → 1020，同口径下 1020 > 1000 → 阻断。 */
        writeLines("src/lib/media/huge.ts", 1020);
        const { code, output } = runWith(["--strict"]);
        expect(code).toBe(1);
        expect(output).toContain("R5 超限文件继续变大");
      });

      it("基线版本里没有该文件（本次新增）→ 退回记录值，不静默漏放", () => {
        const rev = commitAs("src/lib/other.ts", 10, "empty baseline");
        writeLines("src/lib/media/huge.ts", 1000);
        writeBaselineAtRev({ "src/lib/media/huge.ts": 900 }, rev);

        const { code, output } = runWith(["--strict"]);
        expect(code).toBe(1);
        expect(output).toContain("R5 超限文件继续变大");
      });

      it("基线缺 baselineRev（旧基线）→ 退回记录值，行为与历史一致", () => {
        writeLines("src/lib/media/huge.ts", 1000);
        writeBaseline({ "src/lib/media/huge.ts": 1000 });
        const { code, output } = runWith(["--strict"]);
        expect(code).toBe(0);
        expect(output).toContain("[structure] OK");
      });

      it("--update 记下 baselineRev（供日后同口径重数）", () => {
        writeLines("src/lib/media/huge.ts", 1000);
        git("add", "-A");
        git("commit", "-qm", "seed");
        const rev = head();
        expect(runWith(["--update"]).code).toBe(0);
        const written = JSON.parse(readFileSync(BASELINE(), "utf8")) as {
          baselineRev?: string;
        };
        expect(written.baselineRev).toBe(rev);
      });

      /* ── 基线修订号不可达（ISSUE #653）──
       * 现场：基线的 `baselineRev` 记的是**分支提交**，合并后失去 ref 指向；下一次
       * `git gc` 把它清掉，`git show <rev>:<file>` 从此一律失败 —— 同口径重数静默
       * 退化成「拿记录值直接比」，而记录值记在另一个格式时代的源码上。表现是**一个字
       * 都没改的文件天天判红**，报错却写「R5 超限文件继续变大」。
       *
       * 判据修成两支：修订号可用 → 同口径重数（上面的用例）；不可达 → 直接报
       * 「基线修订号取不到」，可行动作是重记基线，而不是拆文件。 */
      it("基线修订号不可达 → 报「取不到」并指向重记基线，不误报成文件变大", () => {
        writeLines("src/lib/media/huge.ts", 1000);
        git("add", "-A");
        git("commit", "-qm", "seed");
        /* 记录值比当前小（基线的那个格式时代数得少），修订号却取不到。 */
        writeBaselineAtRev({ "src/lib/media/huge.ts": 900 }, "0".repeat(40));

        const { code, output } = runWith(["--strict"]);
        expect(code).toBe(1);
        expect(output).toContain("R5 基线修订号");
        expect(output).toContain("取不到");
        expect(output).toContain("--update 重记基线");
        /* 关键：不再把它说成「这个文件变大了」——那是另一支判据。 */
        expect(output).not.toContain("R5 超限文件继续变大");
      });

      it("基线修订号不可达且内容真变大 → 同样只指向重记基线（不放行也不误报）", () => {
        writeLines("src/lib/media/huge.ts", 1000);
        git("add", "-A");
        git("commit", "-qm", "seed");
        writeBaselineAtRev({ "src/lib/media/huge.ts": 990 }, "f".repeat(40));
        writeLines("src/lib/media/huge.ts", 1200);

        const { code, output } = runWith(["--strict"]);
        expect(code).toBe(1);
        expect(output).toContain("R5 基线修订号");
        expect(output).toContain("取不到");
      });

      it("基线修订号可达 → 走同口径重数那一支（不落进「取不到」）", () => {
        const rev = commitAs("src/lib/media/huge.ts", 1000, "baseline");
        writeBaselineAtRev({ "src/lib/media/huge.ts": 900 }, rev);
        writeLines("src/lib/media/huge.ts", 1020);
        const { code, output } = runWith(["--strict"]);
        expect(code).toBe(1);
        expect(output).toContain("R5 超限文件继续变大");
        expect(output).not.toContain("取不到");
      });
    });
  });
});

describe("Build-Guard.ps1（构建前置守卫）", () => {
  /* 用例真实 spawn PowerShell（5.1 冷启动 + 造数据 + 收输出），单条常态就要
   * 3~4s；全量并行满载时 5s 默认超时偶发击穿（2026-09-13 两次）。整组放宽到
   * 20s——只影响本 describe，不掩盖其它文件的真实挂起。 */
  vi.setConfig({ testTimeout: 20_000 });
  /**
   * 复现并锁住「cargo 覆盖 target\release\app.exe 时拒绝访问 (os error 5)」这条
   * 已知故障路径（规范 §5）：壳还在跑 → 覆盖被拒 → 整轮编译白跑。
   * 守卫的判据是「进程 exe 路径落在本仓库 src-tauri\target\{release,debug}\」，
   * 因此这里用 PowerShell 打桩 Get-CimInstance，喂两类进程验证筛选：
   *   - 本仓库 target 下的 app.exe（含大小写/相对段差异）→ 必须命中
   *   - 别处路径的 app.exe、命令行恰好含项目根但路径在外的 app.exe → 必须不命中
   */
  // Windows PowerShell 5.1 与 PowerShell 7 都可用；非 Windows 平台（Linux CI）没有
  // powershell，相关用例跳过，规则本身由 scripts/check-file-structure.cjs 与
  // 本文件其它用例覆盖。
  const psExe = (() => {
    for (const candidate of ["powershell", "pwsh"]) {
      try {
        execFileSync(candidate, ["-NoProfile", "-Command", "exit 0"], {
          stdio: "ignore",
        });
        return candidate;
      } catch {
        // 试下一个候选
      }
    }
    return "";
  })();

  // 结论在 stdout，守卫的日志（`Log` 被桩件改写到 stderr）要一起收，
  // 否则「回收陈旧壳」「非交互构建」「请先结束启动器」这些可见出口断言不到。
  // PS 5.1 对重定向输出默认按系统 ANSI 代码页（zh-CN 为 GBK）编码中文，这里
  // 按 UTF-8 读必是乱码，故在会话内先强制 UTF-8（pwsh 7 本就 UTF-8，前置语句
  // 是无害重复；setter 在无控制台句柄的宿主可能抛错，吞掉即可）。
  const psUtf8Prelude =
    "try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}\n";
  const runGuard = (script: string): string => {
    const proc = spawnSync(
      psExe,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        psUtf8Prelude + script,
      ],
      { encoding: "utf8" },
    );
    return `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  };

  // 打桩 Get-CimInstance（进程枚举）与 taskkill（回收动作）：既用来验证筛选规则，
  // 也用来验证「陈旧壳 / 非交互构建自动回收后继续」与「启动器还在跑才中止」这两条
  // ISSUE #412 的判据——不真的动本机进程。
  //
  // 造数据用 `{ Id, Path, Cmd, Name }`：Name 为 `app.exe`（壳）或启动器 exe 名
  // （`start-tauri.exe` 等）。`Name='xxx'` 按名过滤；`ProcessId=<n>` 用来回答
  // 「我是谁 / 我爹是谁」（`Test-UnattendedBuild` 靠它判双击 / 由启动器拉起），
  // 桩件查自身时如实回 `$PID`，查父进程时回 `opts.parent`。
  const guardScript = (
    procsJson: string,
    opts: { parent?: string; processes?: unknown[] } = {},
  ): string => `
$ErrorActionPreference = "Stop"
function Log { param([string]$Msg) Write-Output $Msg }
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  $rows = '${procsJson}' | ConvertFrom-Json
  if ($Filter -match "ProcessId=(\\d+)") {
    $want = [int]$Matches[1]
    if ($want -eq $PID) {
      [pscustomobject]@{ ProcessId = $PID; ParentProcessId = 9001; Name = "pwsh.exe" }
    } elseif ($want -eq 9001) {
      [pscustomobject]@{ ProcessId = 9001; ParentProcessId = 0; Name = "${opts.parent ?? "pwsh.exe"}" }
    }
    return
  }
  foreach ($r in $rows) {
    if ($r.Name -and $Filter -notlike ("*" + [char]39 + $r.Name + [char]39 + "*")) { continue }
    if ($global:KILLED_PIDS -contains [int]$r.Id) { continue }
    [pscustomobject]@{ ProcessId = $r.Id; ExecutablePath = $r.Path; CommandLine = $r.Cmd }
  }
}
function Get-Process {
  # 打桩进程表：Modules 是「文件被映射进了哪个进程」的判据，产物目录的占用者靠它查
  # （见 Get-ProductDirHolder）。不桩掉就会去扫本机的真实进程表 —— 断言会随开发机
  # 当下开着什么而变，红/绿不再可归因。
  param([Parameter(ValueFromRemainingArguments = $true)]$Args)
  $rows = '${JSON.stringify(opts.processes ?? [])}' | ConvertFrom-Json
  foreach ($r in $rows) {
    [pscustomobject]@{
      Id = $r.Id
      ProcessName = $r.Name
      Path = $r.Path
      Modules = @($r.Modules | ForEach-Object { [pscustomobject]@{ FileName = $_ } })
    }
  }
}
function taskkill {
  param([Parameter(ValueFromRemainingArguments = $true)]$Args)
  Write-Output ("KILL " + ($Args -join " "))
  $global:KILLED = [int]$global:KILLED + 1
  # 记下参数形态：守卫把 taskkill 的**输出**重定向到 Out-Null，只看 KILL 行断言不到
  # 「杀的是不是整棵树（/T /F）」，所以在桩件里留一份参数供断言。
  $global:KILL_ARGS += ($Args -join " ")
  # 模拟回收：记住被杀掉的 PID，后续查询不再返回它们（否则「回收后复查」这条路
  # 在桩件里永远走不通，测不出守卫真实的继续/中止分支）
  if ($Args.Count -ge 2 -and $Args[0] -eq "/PID") {
    $global:KILLED_PIDS += [int]$Args[1]
  }
}
$global:KILLED_PIDS = @()
$script:KILLED_PIDS = @()
$global:KILL_ARGS = @()
. "${GUARD}"
$root = "${process.cwd()}"
$hits = @(Get-RunningShellProcess -ProjectRoot $root)
Write-Output ("HITS=" + $hits.Count)
foreach ($h in $hits) { Write-Output ("HIT=" + $h.Id) }
`;

  it.skipIf(!psExe)("命中本仓库 target 下的运行中壳", () => {
    const root = process.cwd();
    const json = JSON.stringify([
      {
        Id: 111,
        Path: join(root, "src-tauri", "target", "release", "app.exe"),
        Cmd: "",
        Name: "app.exe",
      },
      { Id: 222, Path: "D:\\other\\app.exe", Cmd: "", Name: "app.exe" },
      { Id: 333, Path: "", Cmd: `other ${root} unrelated`, Name: "app.exe" },
    ]);
    const out = runGuard(guardScript(json));
    expect(out).toContain("HITS=2");
    expect(out).toContain("HIT=111");
    expect(out).toContain("HIT=333");
  });

  it.skipIf(!psExe)("路径大小写不同也算命中", () => {
    const root = process.cwd();
    const json = JSON.stringify([
      {
        Id: 444,
        Path: join(root, "SRC-TAURI", "Target", "Release", "APP.EXE"),
        Cmd: "",
        Name: "app.exe",
      },
    ]);
    const out = runGuard(guardScript(json));
    expect(out).toContain("HITS=1");
    expect(out).toContain("HIT=444");
  });

  it.skipIf(!psExe)("没有任何壳进程时返回 0 项", () => {
    const out = runGuard(guardScript(JSON.stringify([])));
    expect(out).toContain("HITS=0");
  });

  /**
   * ISSUE #412：用户双击 build-all 时一上来就被「目标文件被占用」挡下，
   * 提示「请先关闭桌面窗口」——可窗口早就关了，照做也关不掉，卡成死循环。
   *
   * 判据收敛成：陈旧壳（起它的启动器已退出 = 无主孤儿壳）与非交互构建下的占用
   * 自动回收后继续；只有「启动器还在跑 / 用户可能正开着应用」才中止。
   * 这里用打桩进程表把三条规则各锁一次（回收动作走 Write-Output 便于断言）。
   */
  // 结论走 stdout、守卫日志走 stderr（同 dev-launcher 用例的套路）：`Log` 若也写
  // stdout，正文会与 `CODE=` 挤在同一行，断言被日志粘住而失衡。
  // KILLED 计数用 `$global:`（Assert-ShellNotRunning 有自己的作用域，`$script:` 改不到）。
  const assertShellScript = (
    procsJson: string,
    opts: { parent?: string } = {},
  ): string =>
    guardScript(procsJson, opts)
      .replace(
        "function Log { param([string]$Msg) Write-Output $Msg }",
        "function Log { param([string]$Msg) [Console]::Error.WriteLine($Msg) }",
      )
      .replace(
        "$global:KILLED_PIDS = @()",
        "$global:KILLED = 0\n$global:KILLED_PIDS = @()",
      ) +
    `
$code = Assert-ShellNotRunning -ProjectRoot $root -Purpose "构建 release 壳"
Write-Output ("CODE=" + $code)
Write-Output ("KILLED=" + $global:KILLED)
Write-Output ("KILLS=" + ($global:KILL_ARGS -join "|"))
Write-Output ("|END")
`;

  it.skipIf(!psExe)(
    "陈旧壳（启动器已退出）自动回收后继续构建，不再要求用户去关窗口",
    () => {
      const root = process.cwd();
      const json = JSON.stringify([
        {
          Id: 711,
          Path: join(root, "src-tauri", "target", "release", "app.exe"),
          Cmd: "",
          Name: "app.exe",
        },
      ]);
      // 进程表里没有任何本仓库启动器 -> 该壳是无主孤儿壳
      const out = runGuard(assertShellScript(json));
      expect(out).toContain("CODE=0");
      expect(out).toContain("KILLED=1");
      expect(out).toContain("回收陈旧桌面壳");
      // 回收必须杀整棵树：单杀 leader 会留下它拉起的 node / next（占端口、锁产物）。
      // 这条契约原先钉在 `dev-launcher.ps1` 的自有实现上，那份实现已收进本守卫，
      // 断言随之搬到这里（旧用例测的函数早已不存在，只剩一句永远失败的断言）。
      expect(out).toContain("KILLS=/PID 711 /T /F");
    },
  );

  it.skipIf(!psExe)(
    "启动器还在跑时不自动回收，改为中止并点名要求先结束启动器（ISSUE #412）",
    () => {
      const root = process.cwd();
      const json = JSON.stringify([
        {
          Id: 721,
          Path: join(root, "src-tauri", "target", "release", "app.exe"),
          Cmd: "",
          Name: "app.exe",
        },
        {
          Id: 722,
          Path: join(root, "start-tauri", "start-tauri.exe"),
          Cmd: "",
          Name: "start-tauri.exe",
        },
      ]);
      const out = runGuard(assertShellScript(json, { parent: "pwsh.exe" }));
      expect(out).toContain("CODE=1");
      expect(out).toContain("KILLED=0");
      expect(out).toContain("请先结束启动器");
    },
  );

  it.skipIf(!psExe)(
    "双击构建（父进程 explorer）没人能确认，占用一律自动回收后继续",
    () => {
      const root = process.cwd();
      const json = JSON.stringify([
        {
          Id: 731,
          Path: join(root, "src-tauri", "target", "release", "app.exe"),
          Cmd: "",
          Name: "app.exe",
        },
        {
          Id: 732,
          Path: join(root, "start-tauri", "start-tauri.exe"),
          Cmd: "",
          Name: "start-tauri.exe",
        },
      ]);
      const out = runGuard(assertShellScript(json, { parent: "explorer.exe" }));
      expect(out).toContain("CODE=0");
      expect(out).toContain("KILLED=1");
      expect(out).toContain("非交互构建");
    },
  );

  /**
   * ISSUE #621：发布构建第二步（打包 start-tauri.exe）在清理产物时报
   * 「无法清理 start-tauri，可能被其他程序占用（如 start-tauri.exe 仍在运行）」，
   * 而用户刚刚关掉的是**桌面窗口**——启动器自己是独立 exe，关窗并不让它退出，
   * 它继续锁着 `start-tauri\_internal\*.dll`。旧提示既指不出是谁占着（没查进程表），
   * 动作也不对（叫用户去关一个已经关了的窗口）。
   *
   * 现在打包脚本编译/打包前先经 `Assert-LauncherNotRunning` 自查启动器，命中即
   * 点名 PID + 给 `taskkill /PID <pid> /T /F`；这里锁住「哪些进程算命中」。
   *
   * 判据后来补了第二条（`-ProductDir`）：**占用者不一定启动器 exe 本身**。启动器拉起的
   * dev server（node → pnpm → next）会把 `start-tauri\_internal\*.dll` 映射进自己的进程
   * （实测 pnpm 侧的 VCRUNTIME140.dll 就取自产物目录），启动器异常退出后它们残留成孤儿，
   * 目录照样删不掉 —— 而按 exe 名 / 路径判断的判据在这里查到 0 个启动器，于是清理失败，
   * 提示还在猜「是不是启动器没关」，用户照做无效。
   */
  const assertLauncherScript = (
    procsJson: string,
    opts: { processes?: unknown[]; productDir?: string } = {},
  ): string => {
    const dirArg = opts.productDir ? ` -ProductDir "${opts.productDir}"` : "";
    return (
      guardScript(procsJson, { processes: opts.processes }).replace(
        "function Log { param([string]$Msg) Write-Output $Msg }",
        "function Log { param([string]$Msg) [Console]::Error.WriteLine($Msg) }",
      ) +
      `
$code = Assert-LauncherNotRunning -ProjectRoot $root -Purpose "打包启动器"${dirArg}
Write-Output ("CODE=" + $code)
Write-Output ("|END")
`
    );
  };

  it.skipIf(!psExe)("启动器在跑时打包被拦下，并点名 PID（ISSUE #621）", () => {
    const root = process.cwd();
    const json = JSON.stringify([
      {
        Id: 811,
        Path: join(root, "start-tauri", "start-tauri.exe"),
        Cmd: "",
        Name: "start-tauri.exe",
      },
    ]);
    const out = runGuard(assertLauncherScript(json));
    expect(out).toContain("CODE=1");
    expect(out).toContain("正在运行的启动器：PID 811");
    expect(out).toContain("taskkill /PID <上面的 PID> /T /F");
  });

  it.skipIf(!psExe)(
    "没有启动器在跑时打包照常继续，别处的同名进程不算占用",
    () => {
      const json = JSON.stringify([
        {
          Id: 821,
          Path: "D:\\other\\start-tauri.exe",
          Cmd: "",
          Name: "start-tauri.exe",
        },
        { Id: 822, Path: "D:\\other\\app.exe", Cmd: "", Name: "app.exe" },
      ]);
      const out = runGuard(assertLauncherScript(json));
      expect(out).toContain("CODE=0");
      expect(out).not.toContain("正在运行的启动器");
    },
  );

  it.skipIf(!psExe)("三个启动器产物目录（-dev / -standalone）都算占用", () => {
    const root = process.cwd();
    const json = JSON.stringify([
      {
        Id: 831,
        Path: join(root, "start-tauri-dev", "start-tauri-dev.exe"),
        Cmd: "",
        Name: "start-tauri-dev.exe",
      },
    ]);
    const out = runGuard(assertLauncherScript(json));
    expect(out).toContain("CODE=1");
    expect(out).toContain("PID 831");
  });

  it.skipIf(!psExe)(
    "启动器进程的命中同样按 exe 真实路径，别处的同名进程不算",
    () => {
      const json = JSON.stringify([
        {
          Id: 741,
          Path: "D:\\other\\start-tauri.exe",
          Cmd: "",
          Name: "start-tauri.exe",
        },
      ]);
      const out = runGuard(guardScript(json));
      expect(out).toContain("HITS=0");
    },
  );

  it.skipIf(!psExe)(
    "启动器已退出、它拉起的 dev server 还在跑时同样中止，并点名真正的占用者",
    () => {
      // 现场形态：启动器异常退出（本次即「编排器加载模块失败」），它拉起的 dev server
      // 残留成孤儿，把 start-tauri\_internal\*.dll 映射在自己进程里。旧判据在这里查到
      // 0 个启动器，打包一路走到 Remove-Item 才失败，且提示还在猜「启动器没关吧」。
      const root = process.cwd();
      const productDir = join(root, "start-tauri");
      const processes = [
        {
          Id: 921,
          Name: "pnpm-native",
          Path: "C:\\corepack\\pnpm-native.exe",
          Modules: [join(productDir, "_internal", "VCRUNTIME140.dll")],
        },
      ];
      const out = runGuard(
        assertLauncherScript(JSON.stringify([]), { processes, productDir }),
      );
      expect(out).toContain("CODE=1");
      expect(out).toContain("正在占用的进程：PID 921");
      expect(out).toContain(
        `← ${join(productDir, "_internal", "VCRUNTIME140.dll")}`,
      );
      expect(out).toContain("taskkill /PID 921 /T /F");
    },
  );

  it.skipIf(!psExe)(
    "产物目录的占用只认「文件被映射进该进程」，别处的模块不算",
    () => {
      const root = process.cwd();
      const productDir = join(root, "start-tauri");
      const processes = [
        {
          Id: 931,
          Name: "node",
          Path: "D:\\nodejs\\node.exe",
          Modules: [
            "C:\\Windows\\System32\\kernel32.dll",
            "D:\\nodejs\\node.dll",
          ],
        },
      ];
      const out = runGuard(
        assertLauncherScript(JSON.stringify([]), { processes, productDir }),
      );
      expect(out).toContain("CODE=0");
    },
  );

  it.skipIf(!psExe)(
    "启动器自己也在持有者名单里时不重复点名（同一个 PID 只报一次）",
    () => {
      const root = process.cwd();
      const productDir = join(root, "start-tauri");
      const launcherExe = join(productDir, "start-tauri.exe");
      const processes = [
        {
          Id: 811,
          Name: "start-tauri",
          Path: launcherExe,
          Modules: [launcherExe],
        },
      ];
      const json = JSON.stringify([
        { Id: 811, Path: launcherExe, Cmd: "", Name: "start-tauri.exe" },
      ]);
      const out = runGuard(
        assertLauncherScript(json, { processes, productDir }),
      );
      expect(out).toContain("CODE=1");
      expect(out).toContain("正在运行的启动器：PID 811");
      expect(out).not.toContain("正在占用的进程");
    },
  );

  it.skipIf(!psExe)("清理失败时同时给出真实异常与查出来的占用者", () => {
    const root = process.cwd();
    const productDir = join(root, "start-tauri");
    const processes = [
      {
        Id: 941,
        Name: "pnpm-native",
        Path: "C:\\corepack\\pnpm-native.exe",
        Modules: [join(productDir, "_internal", "VCRUNTIME140.dll")],
      },
    ];
    const out = runGuard(
      guardScript(JSON.stringify([]), { processes }) +
        `
Write-ProductDirLockHint -Purpose "打包启动器" -Name "start-tauri" -Directory "${productDir}" -Detail "另一个程序正在使用此文件，进程无法访问。"
`,
    );
    expect(out).toContain("系统报错：另一个程序正在使用此文件，进程无法访问。");
    expect(out).toContain("PID 941");
    expect(out).toContain("taskkill /PID 941 /T /F");
    // 查到占用者就不再给「权限问题 / 杀毒软件」那条分流（它是查不到人时的兜底）
    expect(out).not.toContain("没有查到持有文件的进程");
  });
});

describe("启动链路「不抢前台」判据（python 启动器）", () => {
  /**
   * 应用启动要几十秒，用户很可能切去别的窗口干活；加载完成若是照直把窗口顶到
   * 最前面，正在看的内容就被打断。判据收敛在 start_tauri_launcher.py 的
   * decide_foreground：只有「前台本来就是本应用」「显式冷启动」「唤起已有实例」
   * 才允许自动给前台；**双击启动也不给**——双击之后切去干别的正是常态，等
   * 正式窗口冒出来时用户早就在别处工作了（曾按「用户刚点的启动」放行，结果
   * 连同交接复核的 give 一起把用户打断两次）。其余情形一律留在任务栏并用
   * 任务栏闪烁提示（Rust 壳侧 show_main_window_without_focus 执行）。
   *
   * Win32 前台窗口在 Linux CI 上取不到，因此按本文件里 PowerShell 桩件的同一套路：
   * 把函数源码从启动器里抽出来、打桩 _window_process_name 后直接断言判决表，
   * 锁住「默认不抢前台」这条用户可感知行为。
   */
  const LAUNCHER_PY = join(process.cwd(), "scripts", "start_tauri_launcher.py");
  const python = (() => {
    for (const candidate of ["python3", "python"]) {
      try {
        execFileSync(candidate, ["-c", "import sys; sys.exit(0)"], {
          stdio: "ignore",
        });
        return candidate;
      } catch {
        // 试下一个候选
      }
    }
    return "";
  })();

  /** 抽 decide_foreground / foreground_window_process 的源码，打桩后跑一次判决。 */
  const decide = (call: string, foregroundProcess: string): string => {
    const script = `
import ast, json, sys

src = open(${JSON.stringify(LAUNCHER_PY)}, encoding="utf-8").read()
tree = ast.parse(src)
wanted = {"decide_foreground", "foreground_window_process", "_foreground_window_path"}
blocks = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted]
namespace = {}
exec(compile(ast.Module(body=blocks, type_ignores=[]), "<stub>", "exec"), namespace)

messages = []
namespace["log"] = lambda msg: messages.append(str(msg))
namespace["foreground_window_process"] = lambda: ${JSON.stringify(foregroundProcess)}
# 按检出窗口识别前缀（launch-and-build.md §1.4）：stub 里置空 = 未初始化的
# 旧行为（仅按进程名判定）；这些用例锁的是前台判决表本身，不是检出隔离。
namespace["_SHELL_OWN_PREFIX"] = ""

verdict = namespace["decide_foreground"](${call})
print("RESULT=" + json.dumps(verdict))
print("LOG=" + " | ".join(messages))
`;
    const proc = spawnSync(python, ["-c", script], { encoding: "utf8" });
    return `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  };

  it.skipIf(!python)("用户切走了（前台是别的应用）时不自动抢前台", () => {
    const out = decide("", "notepad.exe");
    expect(out).toContain("RESULT=false");
    expect(out).toContain("foreground denied");
  });

  it.skipIf(!python)(
    "双击启动（前台是资源管理器）也不给前台——用户切去干别的正是常态",
    () => {
      const out = decide("", "explorer.exe");
      expect(out).toContain("RESULT=false");
      expect(out).toContain("foreground denied");
    },
  );

  it.skipIf(!python)(
    "前台本来就是本应用（重启 / 更新后重启）允许给前台",
    () => {
      expect(decide("", "app.exe")).toContain("RESULT=true");
    },
  );

  it.skipIf(!python)("脚本 / 终端冷启动允许给前台", () => {
    expect(decide("cold_start=True", "pwsh.exe")).toContain("RESULT=true");
  });

  it.skipIf(!python)("已有实例被唤起（重复启动）允许给前台", () => {
    expect(decide("already_running=True", "pwsh.exe")).toContain("RESULT=true");
  });

  it.skipIf(!python)(
    "双击入口自身的进程（打包后的 start-tauri.exe）同样不给前台",
    () => {
      expect(decide("", "start-tauri.exe")).toContain("RESULT=false");
    },
  );
});

describe("桌面壳 PID 文件的残留窗口（ISSUE #412 附带修复）", () => {
  /**
   * `log/launcher/tauri-shell.pid` 是「上一轮 run 的残留」：dev-launcher.ps1 是被
   * 本次启动器另起的进程，在它写到「壳已启动」那一步之前，文件里还是上一轮的旧 PID。
   * Windows 会复用 PID，旧号很可能已归某个无关进程——兜底回收路径读到它就会去杀
   * 不相干的东西。修法是拉起 dev-launcher.ps1 之前先删文件（窗口期内读不到 = 安全）。
   */
  const launcher = readFileSync(
    join(process.cwd(), "scripts", "start_tauri_launcher.py"),
    "utf8",
  );

  it("拉起 dev-launcher.ps1 之前先清掉上一轮的壳 PID 文件", () => {
    expect(launcher).toContain("def _reset_shell_pid_file(");
    const start = launcher.indexOf("def launch_dev_server(");
    const body = launcher.slice(start, launcher.indexOf("def monitor(", start));
    expect(body).toContain("_reset_shell_pid_file(project_root)");
    // 必须在 subprocess.Popen 之前（否则清除会把本次真实 PID 一起删掉）
    expect(body.indexOf("_reset_shell_pid_file(")).toBeLessThan(
      body.indexOf("subprocess.Popen("),
    );
  });

  it("兜底回收读不到 PID 文件时不做任何猜测性击杀", () => {
    const body = launcher.slice(
      launcher.indexOf("def _kill_shell_from_pid_file("),
      launcher.indexOf(
        "# ═══",
        launcher.indexOf("def _kill_shell_from_pid_file("),
      ),
    );
    expect(body).toContain("except Exception:");
    expect(body).toContain("return");
  });
});

describe("窗口交接时刻的前台归属复核（独立进程，ISSUE #359 回归）", () => {
  /**
   * 启动期判决只回答了「双击之后用户是不是马上走开了」；用户切去干别的可以持续
   * 几分钟，等应用真正冒出来时「双击入口还在前台」已经失真。更关键的是窗口交接
   * 那一刻：启动页窗口带 WS_EX_TOOLWINDOW，关闭它之后主窗任务栏按钮重建，Windows
   * 会把前台**自动放行**给主窗——壳里任何 set_focus() 都「成功」，「不打断用户」
   * 的策略当场被架空（用户回报的「构建后启动仍然抢前台」）。
   *
   * 因此交接时刻要再裁定一次，判据收敛在 scripts/win32-window-focus.py 的纯函数
   * decide_handoff：只有启动期判决允许给前台才给（give），系统自动放行的前台要还
   * 回去（restore），前台本来就是别的应用就什么都不做（leave）。
   *
   * Win32 部分在 Linux CI 上跑不到，这里按本文件既有套路抽出源码打桩后断言判决表，
   * 锁住这条用户可感知的行为不再回退。
   */
  const FOCUS_SCRIPT = join(process.cwd(), "scripts", "win32-window-focus.py");
  const python = (() => {
    for (const candidate of ["python3", "python"]) {
      try {
        execFileSync(candidate, ["-c", "import sys; sys.exit(0)"], {
          stdio: "ignore",
        });
        return candidate;
      } catch {
        // 试下一个候选
      }
    }
    return "";
  })();

  /** 抽出 decide_handoff 直接断言判决表。 */
  const decide = (call: string): string => {
    const script = `
import ast, json, sys

src = open(${JSON.stringify(FOCUS_SCRIPT)}, encoding="utf-8").read()
tree = ast.parse(src)
blocks = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "decide_handoff"]
namespace = {}
exec(compile(ast.Module(body=blocks, type_ignores=[]), "<stub>", "exec"), namespace)
print("RESULT=" + json.dumps(namespace["decide_handoff"](${call})))
`;
    const proc = spawnSync(python, ["-c", script], { encoding: "utf8" });
    return `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  };

  it.skipIf(!python)("用户就在等它（启动期判决允许）时把前台拿到手", () => {
    expect(
      decide(
        "startup_allowed=True, window_visible=True, window_was_foreground=False",
      ),
    ).toContain('RESULT="give"');
    expect(
      decide(
        "startup_allowed=True, window_visible=True, window_was_foreground=True",
      ),
    ).toContain('RESULT="give"');
  });

  it.skipIf(!python)("不该给但系统交接时自动放行了前台 -> 把前台还回去", () => {
    expect(
      decide(
        "startup_allowed=False, window_visible=True, window_was_foreground=True",
      ),
    ).toContain('RESULT="restore"');
  });

  it.skipIf(!python)(
    "用户切走了（前台是别的应用）时什么都不做，窗口留在任务栏",
    () => {
      expect(
        decide(
          "startup_allowed=False, window_visible=True, window_was_foreground=False",
        ),
      ).toContain('RESULT="leave"');
    },
  );

  it.skipIf(!python)("窗口没显示时不做任何前台动作", () => {
    expect(
      decide(
        "startup_allowed=False, window_visible=False, window_was_foreground=True",
      ),
    ).toContain('RESULT="leave"');
    expect(
      decide(
        "startup_allowed=True, window_visible=False, window_was_foreground=False",
      ),
    ).toContain('RESULT="leave"');
  });

  it("壳侧不再无条件 set_focus 试探（那条路径让「别打断用户」形同虚设）", () => {
    const rust = readFileSync(
      join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    const body = rust.slice(
      rust.indexOf("fn show_main_window_without_focus"),
      rust.indexOf("fn open_comfyui_window"),
    );
    expect(body).toContain("if activate {");
    // 无条件 set_focus：只在 activate 分支里才允许出现一次
    expect(body.match(/win\.set_focus\(\)/g)?.length).toBe(1);
    // 交接时刻的前台复审入口必须存在（把系统自动放行的前台还回去）
    expect(rust).toContain("win32-window-focus.py");
  });

  it("启动页被用户关闭而主窗仍未显示时，壳整体退出（不留无窗壳进程）", () => {
    // 主窗在 setup 时就以隐藏态创建：只关 splash 的话壳会带着看不见的主窗
    // 继续活着——任务栏残留、dev server 继续拉起、服务就绪后主窗还会自己
    // 弹出来。启动页的关闭请求必须在主窗尚未显示时让整个壳退出。
    const rust = readFileSync(
      join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    // 关闭请求的处理：钩子挂在 splash 窗口对象上、检查主窗可见性、放弃时退出
    const handler = rust.slice(
      rust.indexOf("启动页关闭 = 放弃本次启动"),
      rust.indexOf("启动页看门狗"),
    );
    expect(handler).toContain("WindowEvent::CloseRequested");
    expect(handler).toContain('get_webview_window("splash")');
    expect(handler).toContain("mark_abandoned()");
    expect(handler).toContain(".exit(0)");
    // 交接与安全网等「显示主窗」的路径都要被 abandoned 标记拦住
    // （CloseRequested 处理器之外的调用点：交接 / 150s 安全网 / 就绪兜底导航）
    const abandonedGuards = rust.match(/is_abandoned\(\)/g)?.length ?? 0;
    expect(
      abandonedGuards,
      "is_abandoned 拦截必须覆盖全部「显示主窗」路径",
    ).toBeGreaterThanOrEqual(3);
  });

  it("启动器在窗口就绪时拉起交接复核进程", () => {
    const launcher = readFileSync(
      join(process.cwd(), "scripts", "start_tauri_launcher.py"),
      "utf8",
    );
    expect(launcher).toContain("def spawn_foreground_watch(");
    // 三条完成路径（prebuilt / tauri dev / standalone）都要复核
    expect(
      launcher.match(/spawn_foreground_watch\(/g)?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(launcher).toContain("foreground-watch.log");
  });

  it("启动页首次可见时被带到前台（双击启动的反馈，不是「别打断」那一档）", () => {
    // 现场（ISSUE #576）：双击 `start-tauri.exe`，启动页被文件资源管理器压住，
    // 用户看到的是「双击了没反应」。根因是**同一套「不抢前台」策略被套在了启动页上**
    // ——那套策略针对的是几十秒后才冒出来的**应用窗口**（用户可能早已切走）。
    // 启动页是用户刚刚点下去的直接反馈，必须出现在前面。
    const launcher = readFileSync(
      join(process.cwd(), "scripts", "start_tauri_launcher.py"),
      "utf8",
    );
    const focus = readFileSync(FOCUS_SCRIPT, "utf8");
    // ① 启动器：启动页一可见就拉一次（one-shot，只做一次）
    expect(launcher).toContain("def spawn_splash_front(");
    expect(launcher).toMatch(
      /if not splash_front_done and find_tauri_window\(\):/,
    );
    expect(launcher).toContain("splash_front_done = True");
    // ② 判据在复核脚本里，复用已验证可靠的前台手段（Alt + AttachThreadInput）
    expect(focus).toContain("def should_front_splash(");
    expect(focus).toContain("def run_bring_splash(");
    expect(focus).toContain("focus_window(hwnd)");
    // ③ 启动页与主窗是两套判据，不许合并成一条
    expect(focus.indexOf("def should_front_splash(")).toBeGreaterThan(-1);
    expect(focus).toContain("两套判据");
  });

  /**
   * ISSUE #730：启动后有一段「未连接」状态——主窗先露 WebView2 空白 / 内嵌
   * Edge「无法访问此页面」错误页，几秒后才变成 workspace。
   *
   * 这条与 §5 对照表里那条「壳编译时没带 custom-protocol」**同族但不同档**：
   * 那条是导航目标错了（devUrl），这条是导航目标对、但**首帧还没画出来**。
   * 启动页探测到应用端口可响应就调 navigate_to_app，而导航一发起主窗画面就离开
   * 启动页：dev 模式下要等 next dev 首次编译（十几秒），这段等待里主窗就是
   * 空白 / 错误页；而主窗是 `decorations: false`（标题行前端接管），页面没画出来
   * 时连右上角的关闭按钮都不存在——用户看到的就是「窗口没有关闭按钮」。
   *
   * 修法的判据是「**启动等待期的画面只有一个出口**」：
   *   · 应用首帧之前，能看到的东西只能是壳注入的加载占位（壳侧注入、应用侧收尾）；
   *   · TCP 可达性校验（url_reachable）不足以防住这条 —— 连接被接受但首编译未完成
   *     时，on_page_load(Finished) 照样触发，交换窗口就把错误页/空白顶给了用户。
   */
  it("主窗首帧之前由壳注入加载占位，应用挂载时收尾（ISSUE #730）", () => {
    const rust = readFileSync(
      join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    // ① 注入端：占位必须由壳侧 eval 注入（导航一发起 WebView2 就已切走画面，
    //    应用那一端此刻连首帧都没有，能抢在它前面的只有壳）
    expect(rust).toContain("const MAIN_LOADING_STUB_JS");
    expect(rust).toContain("fn watch_main_first_paint(");
    expect(rust).toContain("win.eval(MAIN_LOADING_STUB_JS)");
    // ② 起看护的时机：navigate_to_app 里**导航之前**就要起
    const navigate = rust.slice(
      rust.indexOf("fn navigate_to_app("),
      rust.indexOf("/// 让已显示的应用窗口回到前台"),
    );
    expect(navigate).toContain("watch_main_first_paint(");
    expect(navigate.indexOf("watch_main_first_paint(")).toBeLessThan(
      navigate.indexOf(".navigate(parsed)"),
    );
    // ③ 退出界标：应用文档已渲染 / 主窗已显示 / 用户放弃，三者任一即收手
    const watch = rust.slice(
      rust.indexOf("fn watch_main_first_paint("),
      rust.indexOf("/// 应用退出时回收 sidecar"),
    );
    expect(watch).toContain("is_main_shown()");
    expect(watch).toContain("app_document_shown(");
    expect(watch).toContain("is_abandoned()");
    // ④ 收尾端：交接时清一次，应用挂载时再清一次（占位自带重贴定时器，
    //    不收就会在真界面画好之后又盖回来）
    expect(rust).toContain("fn main_window_clear_loading_stub(");
    expect(rust).toContain('main_window_clear_loading_stub(&main, "swap")');
    const stub = rust.slice(
      rust.indexOf("const MAIN_LOADING_STUB_JS"),
      rust.indexOf("const MAIN_LOADING_STUB_JS") + 2000,
    );
    // 占位要能在「错误页换掉整个 DOM」之后自己贴回来，否则用户看到的还是错误页
    expect(stub).toContain("setInterval(");
    // 但必须有上限，不能永久压着真界面
    expect(stub).toContain("clearInterval(");
    // ⑤ 注入脚本承载的 HTML 必须纯 ASCII：Tauri 的 asset 处理器按字节切响应体
    //    补 nonce，多字节字符会让切片落到字符内部（与 splash-assets 同一条约束）。
    //    注释是中文，所以只对「字面量体」做断言（`r#"` 到 `"#;` 之间）。
    const stubStart = rust.indexOf('const MAIN_LOADING_STUB_JS: &str = r#"');
    const stubEnd = rust.indexOf('"#;', stubStart);
    const stubLiteral = rust.slice(stubStart, stubEnd);
    expect(
      [...stubLiteral].filter((c) => c.charCodeAt(0) > 127).length,
      "承载 HTML 的字符串字面量必须纯 ASCII，中文只许出现在注释里",
    ).toBe(0);
    // …而中文注释里的说明必须是「应用侧怎么收尾」那条（注入端与收尾端同源）
    expect(rust.slice(stubEnd, stubEnd + 400)).toContain("clearLaunchLoadingStub");
    // ⑥ 应用侧收尾：根布局挂载即清（浏览器里没有占位，调用是空操作）
    const cleaner = readFileSync(
      join(process.cwd(), "src", "app", "LaunchLoadingStubCleaner.tsx"),
      "utf8",
    );
    expect(cleaner).toContain("clearLaunchLoadingStub");
    const layout = readFileSync(
      join(process.cwd(), "src", "app", "layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("<LaunchLoadingStubCleaner />");
    const client = readFileSync(
      join(process.cwd(), "src", "lib", "shell", "desktop-shell-client.ts"),
      "utf8",
    );
    expect(client).toContain("export function clearLaunchLoadingStub(");
    expect(client).toContain("__comfyapp_loading_stub");
    // 两端的标记必须是同一个字符串：壳注入的 id / 定时器键与应用侧清理的
    // 键名各写一份就会静默失效（占位永远收不掉）
    expect(stub).toContain("__comfyapp_loading_stub");
    expect(stub).toContain("__comfyappStubTimer");
    expect(client).toContain("__comfyappStubTimer");
  });

  it("standalone 模式不注入占位（内嵌 server 随壳就绪，注入只会白闪）", () => {
    const rust = readFileSync(
      join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    // 「要不要注入」的判据取自启动模式，且判据只有一处（launch_mode 在 run() 里
    // 读一次、传下去），不许 setup_standalone_runtime 再自己读一遍
    expect(rust).toContain("let expect_slow_first_paint = launch_mode != \"standalone\";");
    expect(rust).toContain(
      "watch_main_first_paint(app.handle().clone(), expect_slow_first_paint);",
    );
    expect(rust).toContain("setup_standalone_runtime(app, &launch_mode)?;");
    // 读出的启动模式只许有一处（run()），其余调用点都接收判定结果：
    // 多处读取会让「跳过 sidecar」与「要不要占位」各自漂移
    expect(
      rust.match(/let launch_mode = std::env::var\("COMFYAPP_LAUNCH_MODE"\)/g)
        ?.length,
      "启动模式判据只许有一处：多处读取会让「跳过 sidecar」与「要不要占位」各自漂移",
    ).toBe(1);
  });

  it("壳侧启动页也显式置前一次（本地冷启动时无须等复核进程）", () => {
    const rust = readFileSync(
      join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    expect(rust).toContain("fn bring_splash_to_front(");
    // 只 `show()` 不给前台的写法不够：启动页要真的到前面
    expect(rust).toContain("splash.set_focus()");
    // 用了「不抢前台」那套的话会只闪任务栏 —— 那正是被压住的原因
    expect(rust).toContain("bring_splash_to_front(&splash)");
  });
});

/**
 * ISSUE #730 的 release 壳构建失败（`cargo build --release --features custom-protocol`）。
 *
 * 现场是两条**互不相干**的编译错误（用户日志里同时出现，容易被当成一件事）：
 *
 * 1. `generate_context!` 报一条「解析插件全局 API 脚本路径失败」的错误（报的是
 *    脚本里的尾随逗号与行列号）—— 真正的原因文件根本不在源码里（见下条用例的注释）。
 * 2. `PROBE_ATTEMPTS * PROBE_INTERVAL_MS` 报 `expected u32, found u64`
 *    + `cannot multiply u32 by u64` —— 同一处表达式里的两个常量类型不同档。
 *
 * 两条的共同点是「本地跑 lint / tsc / 单测全绿，只有真编 release 壳才暴露」，
 * 所以判据只能落在「编译前提」这一层。
 */
describe("release 壳构建的地雷（ISSUE #730）", () => {
  it("格式化工具不碰 src-tauri/target（Tauri 的插件脚本清单被折行 = 整壳编译失败）", () => {
    // 现场已在 Linux 上逐字复现（错误信息与用户日志完全一致）：
    //   tauri-build 把插件全局 API 脚本清单写成**紧凑单行** JSON
    //   （serde_json::to_string 不产生换行，因此它自己永远不会带尾逗号）；
    //   文件落在 src-tauri/target/ 下的 out/__global-api-script.js，后缀是 .js。
    //   于是 prettier（`pnpm format:write` / 编辑器保存）按 print-width 把它折成
    //   多行、并给最后一项补一个尾逗号；generate_context! 再读时 serde_json 直接报
    //   "trailing comma"。6 个插件 → 6 项 + 首尾两行 = 8 行，所以「line: 8」
    //   是可以反推出来的：那正是 prettier 折行后的最后一项。
    //   **报错位置落在 lib.rs 的 generate_context! 那一行**，与真正被改坏的
    //   target 生成物毫无关系 —— 这正是本条长期定位不到的原因。
    // 防线是别让格式化工具碰到它。prettier 只按 cwd（仓库根）读 .gitignore，
    // 看不到 src-tauri/.gitignore 里的 /target/，所以必须由根级 .prettierignore 兜。
    const ignore = readFileSync(join(process.cwd(), ".prettierignore"), "utf8");
    expect(
      ignore.split("\n").map((l) => l.trim()),
      "根级 .prettierignore 必须忽略 src-tauri/target/：漏掉它，" +
        "任何在本机 cargo build 过的检出都会在下次提交/格式化后编不出 release 壳",
    ).toContain("src-tauri/target/");
  });

  it("首帧看护的两个常量类型同档（相乘，跨类型编译不过）", () => {
    const rust = readFileSync(
      join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    const typeOf = (name: string): string => {
      const m = new RegExp(`const ${name}: ([A-Za-z0-9]+) =`).exec(rust);
      if (!m) throw new Error(`lib.rs 里找不到 ${name} 的常量声明`);
      return m[1]!;
    };
    // 这两条会在首帧看护的超时日志里相乘：u32 * u64 没有实现（E0277），
    // 同档是编译前提，不是风格偏好。
    expect(typeOf("PROBE_ATTEMPTS")).toBe(typeOf("PROBE_INTERVAL_MS"));
    expect(rust).toContain("(PROBE_ATTEMPTS * PROBE_INTERVAL_MS) / 1000");
  });
});

describe("启动页窗口即内容（紧凑 + 展开日志两档，无边框自绘标题行）", () => {
  /**
   * 启动页的日志面板是「一行一条日志」的不折行布局（`white-space: pre`，见
   * docs/standards/07-日志系统.md §7.18.6），所以**窗口宽度就是可读宽度**：
   * 窗口太窄日志每行都被切成两截（旧的 1280 就是这么来的）。
   *
   * 但「给得宽」的旧做法走到了另一个极端（ISSUE #412）：窗口按 1680×1000 开，
   * 而内容卡片只有 720/1400 宽、收起日志时垂直方向更是大片留白——用户在 2K/4K
   * 屏上看到的是一大块没有任何用途的空白区域。现在的取向是**窗口即内容**：
   *
   * - 开窗 = 紧凑档（够放下收起日志时的内容，见 SPLASH_WINDOW_SIZE）；
   * - 展开日志 = 壳把窗口调到展开档（SPLASH_WINDOW_SIZE_EXPANDED），页面只把
   *   「展开 / 收起」告诉壳（`set_splash_compact`），不自己写第二份尺寸常量；
   * - 两档都按当前显示器收敛（小屏不越界）；
   * - 窗口 `decorations: false`（无原生标题栏），最小化 / 关闭由启动页自身
   *   右上角的按钮提供。
   *
   * 改动三份启动页副本、tauri.conf.json 或 src-tauri/src/lib.rs 时先看这条。
   */
  const CONF = join(process.cwd(), "src-tauri", "tauri.conf.json");
  const LIB_RS = join(process.cwd(), "src-tauri", "src", "lib.rs");
  const SPLASH_COPIES = [
    join(process.cwd(), "src-tauri", "splash-assets", "splash.html"),
    join(process.cwd(), "src-tauri", "splash-assets", "index.html"),
    join(process.cwd(), "public", "splash.html"),
  ];

  const splashWindow = (): {
    label?: string;
    width: number;
    height: number;
    decorations?: boolean;
  } => {
    const conf = JSON.parse(readFileSync(CONF, "utf8")) as {
      app: {
        windows: {
          label?: string;
          width: number;
          height: number;
          decorations?: boolean;
        }[];
      };
    };
    const win =
      conf.app.windows.find((w) => w.label === "splash") ?? conf.app.windows[0];
    if (!win) throw new Error("tauri.conf.json 里没有窗口配置");
    return win;
  };

  /** 从 lib.rs 里取某个尺寸常量（`const NAME: (f64, f64) = (w, h);`）。 */
  const sizeConst = (rust: string, name: string): [number, number] => {
    const m = new RegExp(
      `const ${name}: \\(f64, f64\\) = \\((\\d+(?:\\.\\d+)?), (\\d+(?:\\.\\d+)?)\\);`,
    ).exec(rust);
    if (!m) throw new Error(`lib.rs 里没有常量 ${name}`);
    return [Number(m[1]), Number(m[2])];
  };

  it("splash 开窗是紧凑的一条，不铺满屏幕留空白", () => {
    const win = splashWindow();
    // 高度必须贴着「收起日志时的内容高度」（约 190px），而不是留出一大块空白：
    // 旧值 1680×1000 就是这块空白的来源（内容只占上面两百来像素）。
    expect(win.width).toBeLessThanOrEqual(900);
    expect(win.height).toBeLessThanOrEqual(280);
    expect(win.width).toBeGreaterThanOrEqual(640);
    // 紧凑档必须与壳里的常量一致，否则开窗和回落档会是两个尺寸
    const rust = readFileSync(LIB_RS, "utf8");
    const [compactWidth, compactHeight] = sizeConst(rust, "SPLASH_WINDOW_SIZE");
    expect(compactWidth).toBe(win.width);
    expect(compactHeight).toBe(win.height);
  });

  it("展开日志那一档够放下未折行的日志（旧的 1280 太窄）", () => {
    const rust = readFileSync(LIB_RS, "utf8");
    const [expandedWidth, expandedHeight] = sizeConst(
      rust,
      "SPLASH_WINDOW_SIZE_EXPANDED",
    );
    expect(expandedWidth).toBeGreaterThanOrEqual(1400);
    expect(expandedHeight).toBeGreaterThanOrEqual(700);
    // 紧凑档必须比展开档小，否则「两档」没有意义
    const [compactWidth, compactHeight] = sizeConst(rust, "SPLASH_WINDOW_SIZE");
    expect(compactWidth).toBeLessThan(expandedWidth);
    expect(compactHeight).toBeLessThan(expandedHeight);
  });

  it("窗口尺寸按显示器收敛，小屏上不会被推出屏幕外", () => {
    const rust = readFileSync(LIB_RS, "utf8");
    expect(rust).toContain("fn splash_window_size");
    // 必须真的取过显示器尺寸并用于收敛，而不是只写了个函数
    expect(rust).toContain("primary_monitor()");
    expect(rust).toContain("splash_window_size(app.handle())");
    // 展开档也要过同一条收敛路径
    expect(rust).toContain("fn clamp_to_monitor");
  });

  it("启动页自己提供最小化 / 关闭（窗口没有原生标题栏）", () => {
    const win = splashWindow();
    expect(win.decorations).toBe(false);
    const html = readFileSync(SPLASH_COPIES[0] ?? "", "utf8");
    // 页面里的两个按钮 + 壳侧的窗口动作都要在，缺一个就是「关不掉也缩不了」
    expect(html).toContain('id="btn-minimize"');
    expect(html).toContain('id="btn-close"');
    expect(html).toContain("minimize()");
    expect(html).toContain("close()");
    // 拖拽由页面脚本显式接管（拖不动见 ISSUE #608 那条用例），按钮不吞点击
    expect(html).toContain("startDragging()");
    expect(html).toContain("-webkit-app-region: no-drag");
  });

  /**
   * ISSUE #608：启动页**拖不动**。
   *
   * 窗口没有原生标题栏（`decorations: false`），拖拽区只能自己声明。
   * 两个成因，任一没修都仍然「按住不动」：
   *
   * 1. **权限**：启动页来自内嵌本地源，而 `core:default` **不含**
   *    `core:window:allow-start-dragging`。未授权时窗口侧发起的拖拽会被 ACL
   *    静默拒绝——页面看起来完全正常，就是不动。主窗之所以能拖，是因为
   *    `capabilities/{default,remote}.json` 各自显式补了这条（见 07 §7.18.7）。
   * 2. **拖拽区**：此前只有 `.titlebar` 一条是 drag（十几像素高，右侧还被
   *    按钮占掉），窗口其余大片区域按下去都不动。现在由页面脚本统一接管：
   *    落点不在交互件上就调 `startDragging()`，于是整窗（含内边距）都能拖。
   *
   * 因此判据是「权限 + 显式拖拽路径 + 交互件被排除」三件套，缺一个都还是拖不动。
   * 改动启动页布局或 capabilities 时先看这条。
   */
  it("启动页能拖动位置：显式 startDragging + 交互件排除 + 拖拽权限", () => {
    const html = readFileSync(SPLASH_COPIES[0] ?? "", "utf8");

    // ① 显式拖拽路径（CSS 非客户区判定在各引擎上并不一致，不走那条）
    expect(html).toContain("startSplashDrag");
    expect(html).toContain("startDragging()");
    // 整窗都要能拖：不能只把标题行一条设成 drag（那正是「拖不动」的观感来源）
    expect(html).not.toMatch(/\.titlebar \{[^}]*app-region: drag/);

    // ② 交互件必须被排除，否则点击被拖拽吞掉、日志也没法选中复制
    expect(html).toContain("INTERACTIVE_SELECTOR");
    expect(html).toContain("closest(INTERACTIVE_SELECTOR)");
    const interactive = html.slice(
      html.indexOf("const INTERACTIVE_SELECTOR"),
      html.indexOf("const INTERACTIVE_SELECTOR") + 200,
    );
    expect(interactive).toContain("button");
    expect(interactive).toContain("[data-no-drag]");
    // 窗口按钮 / 查看日志 / 日志面板各自声明 no-drag（与脚本判据同源）
    for (const [start, end] of [
      [".win-buttons {", ".win-btn {"],
      [".log-toggle {", ".log-toggle:hover"],
      [".log-panel {", ".log-panel pre"],
    ] as const) {
      const rule = html.slice(html.indexOf(start), html.indexOf(end));
      expect(rule).toContain("-webkit-app-region: no-drag");
    }

    // ③ 权限：漏了这条，拖拽会被 ACL 静默拒绝（页面完全正常就是不动）
    const splashCap = readFileSync(
      join(process.cwd(), "src-tauri", "capabilities", "splash.json"),
      "utf8",
    );
    expect(splashCap).toContain('"core:window:allow-start-dragging"');
    // 主窗走的是另两份 capability，一并守住「这条权限是每窗各自声明的」
    for (const name of ["default.json", "remote.json"]) {
      expect(
        readFileSync(
          join(process.cwd(), "src-tauri", "capabilities", name),
          "utf8",
        ),
      ).toContain('"core:window:allow-start-dragging"');
    }
  });

  it("三份启动页副本一致，且日志展开由壳统一调尺寸", () => {
    const texts = SPLASH_COPIES.map((p) => readFileSync(p, "utf8"));
    expect(new Set(texts).size).toBe(1);
    const html = texts[0];
    expect(html).toBeDefined();
    if (!html) return;
    // 页面只报「紧凑 / 展开」，尺寸常量只在壳里一份（避免两处常量漂移）
    expect(html).toContain("set_splash_compact");
    expect(html).not.toContain(".card.wide");
    const rust = readFileSync(LIB_RS, "utf8");
    expect(rust).toContain("fn set_splash_compact");
    // 新增应用命令要三处同步：build.rs / capabilities（否则运行期 not allowed by ACL）
    expect(
      readFileSync(join(process.cwd(), "src-tauri", "build.rs"), "utf8"),
    ).toContain('"set_splash_compact"');
    expect(
      readFileSync(
        join(process.cwd(), "src-tauri", "capabilities", "splash.json"),
        "utf8",
      ),
    ).toContain('"allow-set-splash-compact"');
  });

  /**
   * 「窗口按钮点了没反应」的第一道闸：**按钮必须真的能调到窗口能力**。
   *
   * ISSUE #412 的第二次回报就是这个症状（最小化 / 关闭都没效果）。这类问题的
   * 成因不在按钮画得对不对，而在「点击之后调用了什么」：
   *
   * - 事件监听没绑上 / 被顶掉时，内联 onclick 仍要能把动作递出去；
   * - 壳过期（改了 src-tauri 没重编）时，Tauri window API 可能整块不可用，
   *   此时要有**应用自建命令**这条兜底（win_minimize / win_close，随壳一起走
   *   ACL 三处同步），并在都不可用时给出可见提示，而不是静默无反应；
   * - 拖拽区与按钮必须分开声明「别被拖拽吞掉点击」。
   *
   * 改动启动页按钮或壳命令时先看这条。
   */
  it("启动页的窗口按钮有内联兜底，不是只靠 addEventListener", () => {
    const html = readFileSync(SPLASH_COPIES[0] ?? "", "utf8");
    // 内联 onclick 是「脚本没跑到绑定」时的第二道；两条路必须汇到同一个入口
    expect(html).toContain("window.__splashWinAction");
    expect(html).toMatch(
      /onclick="window\.__splashWinAction && window\.__splashWinAction\('minimize'\)"/,
    );
    expect(html).toMatch(
      /onclick="window\.__splashWinAction && window\.__splashWinAction\('close'\)"/,
    );
    expect(html).toContain("performWinAction");
    // 按钮容器整体也不拖拽（个别按钮漏标 no-drag 时的第二层保险）
    const buttonsCss = html.slice(
      html.indexOf(".win-buttons {"),
      html.indexOf(".win-btn {"),
    );
    expect(buttonsCss).toContain("-webkit-app-region: no-drag");
  });

  it("窗口按钮有壳命令兜底，且命令三处同步", () => {
    const html = readFileSync(SPLASH_COPIES[0] ?? "", "utf8");
    expect(html).toContain("win_minimize");
    expect(html).toContain("win_close");
    // 失败必须可见：都调不通时给出提示，不许静默
    expect(html).toContain("noticeWindowAction");

    const rust = readFileSync(LIB_RS, "utf8");
    expect(rust).toContain("fn win_minimize");
    expect(rust).toContain("fn win_close");
    expect(rust).toContain("win_minimize,");
    expect(rust).toContain("win_close,");

    expect(
      readFileSync(join(process.cwd(), "src-tauri", "build.rs"), "utf8"),
    ).toContain('"win_close"');
    const splashCap = readFileSync(
      join(process.cwd(), "src-tauri", "capabilities", "splash.json"),
      "utf8",
    );
    expect(splashCap).toContain('"allow-win-close"');
    expect(splashCap).toContain('"allow-win-minimize"');
  });

  it("自绘启动器的窗口尺寸与启动页同值，且最小化不是空调用", () => {
    const py = readFileSync(
      join(process.cwd(), "scripts", "start_tauri_launcher.py"),
      "utf8",
    );
    const win = splashWindow();
    const w = Number(/^SPLASH_W = (\d+)/m.exec(py)?.[1]);
    const h = Number(/^SPLASH_H = (\d+)/m.exec(py)?.[1]);
    // 同一张「启动中」画面在本链路有两个实现（壳内嵌启动页 / 启动器 Win32 弹窗），
    // 尺寸各写一份就会改一处、两边不一致——这里盯死必须同值。
    expect(w).toBe(win.width);
    expect(h).toBe(win.height);

    // 置顶弹窗不会被 ShowWindow(SW_MINIMIZE) 最小化，必须走「隐藏 + 撤置顶」，
    // 且用定时器维持（否则其它逻辑一 ShowWindow 就把它翻回来）。
    expect(py).toContain("def _minimize");
    expect(py).toContain("def _keep_minimized");
    expect(py).toContain("SW_HIDE");
    expect(py).toMatch(/if self\._minimized:\s*\n\s*self\._keep_minimized\(\)/);
  });

  it("日志面板吃掉窗口剩余高度（展开后不是一条窄缝，也不留空白）", () => {
    const html = readFileSync(SPLASH_COPIES[0] ?? "", "utf8");
    const panel = html.slice(
      html.indexOf(".log-panel {"),
      html.indexOf(".log-panel pre"),
    );
    // 不再写死高度：面板 flex 撑满窗口剩余空间，窗口放大多少就显示多少行
    expect(panel).toContain("flex: 1 1 auto");
    expect(panel).not.toMatch(/height:\s*\d+px/);
    // 单行不折行 + 横向滚动必须保留，否则「加宽」会被折行悄悄取代
    expect(html).toContain("white-space: pre;");
    expect(html).toContain("overflow-x: auto;");
  });
});
