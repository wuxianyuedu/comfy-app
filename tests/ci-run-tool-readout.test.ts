/**
 * 「类型检查」那一格的读数（`scripts/ci-run-tool.mjs`，ISSUE #3041）：过去念不出「按哪一棵树判」。平台 PR 检出的是**合成合并预览**
 * （`HEAD` = 目标分支 ⊕ 本 PR），`CNB_COMMIT` 才是 PR 顶端；两者不同时 `tsc` 行号属合并树，拿 PR 顶端核对必然对不上（#2990）。
 * 夹具钉三件：两 sha 不同 ⇒ 明写「合并后的树」；无 `CNB_COMMIT` ⇒ 念 HEAD 并明写「行号属这棵树」；判决面念 `include`/`exclude` 两条 glob。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "..", "scripts", "ci-run-tool.mjs");

/** 夹具：一棵真 git 仓 + 一份 tsconfig + 一个「报错行号不属于本树」的假编译器。 */
type Fixture = { face: string; fakeCompiler: string; head: string; root: string };

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "ci-run-tool-"));
  const face = path.join(root, "tsconfig.json");
  writeFileSync(
    face,
    JSON.stringify({ include: ["**/*.ts"], exclude: ["node_modules"] }, null, 2),
    "utf8",
  );
  const fakeCompiler = path.join(root, "node_modules", "fake-tsc", "bin", "tsc.mjs");
  mkdirSync(path.dirname(fakeCompiler), { recursive: true });
  writeFileSync(
    fakeCompiler,
    [
      'if (process.argv.includes("--listFilesOnly")) process.exit(0);',
      'console.log("scripts/whatever.mjs(9999,1): error TS9999: 负控制：夹具里没有这一行");',
      "process.exit(1);",
      "",
    ].join("\n"),
    "utf8",
  );
  const shim = path.join(root, "node_modules", ".bin", "tsc");
  mkdirSync(path.dirname(shim), { recursive: true });
  writeFileSync(shim, `# cmd-shim-target=${fakeCompiler}\n`, "utf8");
  execFileSync("git", ["init", "-q", "-b", "master", "."], { cwd: root });
  execFileSync("git", ["config", "user.email", "readout@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "readout"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return { root, head, face, fakeCompiler };
}

const fixtures: Fixture[] = [];

afterEach(() => {
  for (const f of fixtures.splice(0)) {
    rmSync(f.root, { recursive: true, force: true });
  }
});

/** 以夹具为 cwd 起 `ci-run-tool tsc --noEmit`，返回合并后的 stdout。 */
function runReadout(fixture: Fixture, overrides: Record<string, string>): string {
  fixtures.push(fixture);
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CNB_COMMIT;
  Object.assign(env, overrides);
  const res = spawnSync(process.execPath, [SCRIPT, "--root", fixture.root, "tsc", "--noEmit"], {
    cwd: fixture.root,
    encoding: "utf8",
    env,
  });
  expect(res.status).toBe(1);
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 出参：子进程起不来 / 无输出时 stdout 实测为 null，@types/node 按非空标，保留空串兜底
  const stdout = String(res.stdout ?? "");
  /* 转发本身也是判据的一部分：读数是加法，不许把子进程的输出吞掉。 */
  expect(stdout).toContain("error TS9999");
  return stdout;
}

describe("#3041：类型检查格的树读数", () => {
  it("① CNB_COMMIT ≠ HEAD：念出两个 sha，并标明行号属于合并后的树（负控制：报错行号在夹具里不存在）", () => {
    const fixture = makeFixture();
    const cnb = "1".repeat(40);
    const stdout = runReadout(fixture, { CNB_COMMIT: cnb });
    expect(stdout).toContain(
      `读取的树：HEAD ${fixture.head.slice(0, 12)} · CNB_COMMIT ${cnb.slice(0, 12)}` +
        "（≠ HEAD：平台合成合并预览，报错行号属于合并后的树，别拿 PR 顶端逐行对照）",
    );
  });

  it("② 没有 CNB_COMMIT（本地）：念出 HEAD，并标明行号属于这棵树", () => {
    const fixture = makeFixture();
    const stdout = runReadout(fixture, {});
    expect(stdout).toContain(`读取的树：HEAD ${fixture.head.slice(0, 12)}（非平台检出`);
  });

  it("③ 判决面同时念出 include 与 exclude（两条 glob 都显式）", () => {
    const fixture = makeFixture();
    const stdout = runReadout(fixture, { CNB_COMMIT: fixture.head }).replaceAll("\\", "/");
    const face = fixture.face.replaceAll("\\", "/");
    expect(stdout).toContain(`${face}（tsc 默认（cwd 的 tsconfig.json）`);
    expect(stdout).toContain("include: **/*.ts；exclude: node_modules");
    expect(stdout).toContain(
      `读取的树：HEAD ${fixture.head.slice(0, 12)}（= CNB_COMMIT，报错行号属于本 SHA）`,
    );
  });
});
