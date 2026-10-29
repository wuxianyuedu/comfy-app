/**
 * 产品版本号三处同步判据的自检（ISSUE #1611 阶段三 D7，规范 launch-and-build §7.1.1）。
 *
 * 立案现场：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`
 * 三处手写同一个版本号（**当时恰好相等**），而**没有任何一处判据认识它**。这不是
 * 「改名要去三个地方」的麻烦 —— `tauri.conf.json` 的版本在编译期内嵌进壳，也是
 * `tauri-plugin-updater` 判「更新新旧」的基准：只升 `package.json` 时安装包与更新
 * 判定还停在旧版本，用户点「检测更新」看到「已是最新」，而实际发布的已经是新构建。
 *
 * 四头判据，缺一头这层就退化：
 *   ① **拦得住**：三处不一致即红；
 *   ② **读不出也红**：某处字段被改名 / 挪段（`[workspace.package]`）时不许静默放行；
 *   ③ **不误伤**：`Cargo.toml` 别的段里的 `version = "…"`（依赖表内联表）不算产品版本；
 *   ④ **接线在**：`package.json` 有入口、钩子 D 组真跑它（判据写在文件里没人跑 =
 *      §13.5.12 那个「判据自称在跑」的形态）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineGateRepo, describe } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-app-version.cjs",
  /* 三处都在仓库根之外的子目录里，脚本用 `__dirname/..` 定根 —— 落 `scripts/`。 */
  workdir: "app-version-gate",
});

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/** 一条把三处写全的「合法工作区」（各条用例只改它要测的那一处）。 */
function writeAll(
  repo: { write: (rel: string, content: string) => void },
  { pkg = "0.1.0", tauri = "0.1.0", cargo = "0.1.0" } = {},
): void {
  repo.write("package.json", `{\n  "name": "probe",\n  "version": "${pkg}"\n}\n`);
  repo.write(
    "src-tauri/tauri.conf.json",
    `{\n  "productName": "ComfyAPP",\n  "version": "${tauri}"\n}\n`,
  );
  repo.write(
    "src-tauri/Cargo.toml",
    `[package]\nname = "app"\nversion = "${cargo}"\n\n[dependencies]\ntauri = { version = "2", features = [] }\n`,
  );
}

describe("产品版本号三处同步（D7）", () => {
  test("三处一致 → 退 0，且报告里点名三处出处", ({ repo }) => {
    writeAll(repo);
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("0.1.0");
    expect(r.output).toContain("package.json");
    expect(r.output).toContain("src-tauri/tauri.conf.json");
    expect(r.output).toContain("src-tauri/Cargo.toml");
  });

  test("① 只升 package.json（tauri.conf.json 落后）→ 红，并指出是哪两处不等", ({
    repo,
  }) => {
    writeAll(repo, { pkg: "0.2.0", tauri: "0.1.0" });
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("0.2.0");
    expect(r.output).toContain("0.1.0");
    expect(r.output).toContain("不一致");
  });

  test("① Cargo.toml 落后同样红（三处两两都判，不是只比前两处）", ({ repo }) => {
    writeAll(repo, { cargo: "0.9.9" });
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("0.9.9");
  });

  test("② 某处文件不存在 → 红（不许静默放行）", ({ repo }) => {
    writeAll(repo);
    repo.remove("src-tauri/tauri.conf.json");
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src-tauri/tauri.conf.json");
  });

  test("② `Cargo.toml` 把版本挪出 `[package]` 段 → 红（读不出 = 字段被挪位）", ({
    repo,
  }) => {
    writeAll(repo);
    repo.write(
      "src-tauri/Cargo.toml",
      `[package]\nname = "app"\n\n[workspace.package]\nversion = "0.1.0"\n`,
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("提取不出");
  });

  test("② `package.json` 里没有 version 字段 → 红", ({ repo }) => {
    writeAll(repo);
    repo.write("package.json", `{\n  "name": "probe"\n}\n`);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("提取不出");
  });

  test("③ `[dependencies]` 段里的 `version` 不算产品版本（按段切，不裸 grep）", ({
    repo,
  }) => {
    writeAll(repo);
    /* 依赖表里写一个与产品版本不同的数：裸 grep 会把它读进来 → 三处「不一致」误报。 */
    repo.write(
      "src-tauri/Cargo.toml",
      `[package]\nname = "app"\nversion = "0.1.0"\n\n[dependencies.foo]\nversion = "9.9.9"\n`,
    );
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).not.toContain("9.9.9");
  });

  test("形态非法（`0.1` 这种两位）→ 红，且报的是形态不是「不等」", ({ repo }) => {
    writeAll(repo, { pkg: "0.1", tauri: "0.1", cargo: "0.1" });
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("MAJOR.MINOR.PATCH");
  });

  test("带 `-pre` 后缀的形态合法（三个配置文件都是字符串，判据只求同）", ({
    repo,
  }) => {
    writeAll(repo, { pkg: "1.0.0-rc.1", tauri: "1.0.0-rc.1", cargo: "1.0.0-rc.1" });
    const r = repo.run();
    expect(r.code).toBe(0);
  });

  test("`--report` 只打印三处读数、不判失败（三处不一致也退 0）", ({ repo }) => {
    writeAll(repo, { pkg: "0.2.0", tauri: "0.1.0" });
    const r = repo.run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("0.2.0");
    expect(r.output).toContain("0.1.0");
    expect(r.output).not.toContain("✗");
  });

  test("④ `package.json` 有 `check:app-version` 入口（判据有执行者）", () => {
    const pkg = /* SAFETY: 类型断言已复核 */ JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:app-version"]).toBe(
      "node scripts/check-app-version.cjs",
    );
  });

  test("④ pre-commit 的 D 组真跑这一步（写在文件里没人跑 = 没有等价）", () => {
    const hook = readFileSync(
      path.join(REPO_ROOT, ".githooks", "pre-commit"),
      "utf8",
    );
    const steps = [...hook.matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) => ({
      label: m[1] ?? "",
      cmd: m[2] ?? "",
    }));
    const hit = steps.find((s) => s.cmd.includes("check-app-version.cjs"));
    expect(hit, `D 组 ${steps.length} 步里没有版本号同步判据`).toBeDefined();
    expect(hit?.cmd).toBe("node scripts/check-app-version.cjs");
  });
});
