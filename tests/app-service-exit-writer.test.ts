/**
 * `scripts/app-service-exit.mjs` 写侧的落盘契约（ISSUE #1692）。
 *
 * 这份记录是「应用服务为什么断了」在**事后唯一还能读到的证据**：探活走的是刚死掉
 * 那个服务自己的 HTTP，事后问不到。所以写侧的形态（落点、字段、无 BOM、不因为
 * 退出码 / 信号拿不到而编一个值）每一条都是判据，不是实现细节。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type ExitModule = {
  APP_SERVICE_EXIT_FILE: string;
  appServiceExitPath: (root: string) => string;
  writeAppServiceExit: (root: string, input: Record<string, unknown>) => boolean;
}

const mod = /* SAFETY: 类型断言已复核 */ (await import(
  pathToFileURL(join(process.cwd(), "scripts", "app-service-exit.mjs")).href
)) as unknown as ExitModule;

const dirs: Array<string> = [];
function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "comfyapp-exit-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function read(root: string): Record<string, unknown> {
  return /* SAFETY: 类型断言已复核 */ JSON.parse(
    readFileSync(join(root, "run", mod.APP_SERVICE_EXIT_FILE), "utf8"),
  ) as Record<string, unknown>;
}

describe("writeAppServiceExit", () => {
  it("落在 run/app-service-exit.json（与 launch-status.json 同属本次运行的现场）", () => {
    const root = tmpRoot();
    expect(mod.writeAppServiceExit(root, { kind: "dev-server", reason: "x" })).toBe(true);
    expect(mod.appServiceExitPath(root)).toBe(join(root, "run", mod.APP_SERVICE_EXIT_FILE));
    expect(read(root).kind).toBe("dev-server");
  });

  it("无 BOM（读取侧 JSON.parse 遇 BOM 会当场失败）", () => {
    const root = tmpRoot();
    mod.writeAppServiceExit(root, { kind: "dev-server", reason: "x" });
    const raw = readFileSync(join(root, "run", mod.APP_SERVICE_EXIT_FILE), "utf8");
    expect(raw.startsWith("\uFEFF")).toBe(false);
  });

  it("拿不到退出码 / 信号时写 null，绝不编一个 0", () => {
    const root = tmpRoot();
    mod.writeAppServiceExit(root, { kind: "dev-server", reason: "x" });
    const body = read(root);
    // 0 是「正常退出」这个具体结论，编出来会把故障说成正常。
    expect(body.code).toBeNull();
    expect(body.signal).toBeNull();
  });

  it("type 不对的可选字段退回 null（不把字符串当数字写）", () => {
    const root = tmpRoot();
    mod.writeAppServiceExit(root, {
      kind: "dev-server",
      reason: "x",
      code: "1",
      signal: "",
      port: "3100",
      runId: 7,
    });
    expect(read(root)).toMatchObject({
      code: null,
      signal: null,
      port: null,
      runId: null,
    });
  });

  it("同一条根目录重复写会覆盖（记录只有「最近一次」，不做历史）", () => {
    const root = tmpRoot();
    mod.writeAppServiceExit(root, { kind: "dev-server", reason: "旧" });
    mod.writeAppServiceExit(root, { kind: "sidecar", reason: "新" });
    expect(read(root)).toMatchObject({ kind: "sidecar", reason: "新" });
  });

  it("写不进去时返回 false 而不是抛错（排障体验不该把收尾带崩）", () => {
    // 用一个不可能建目录的路径当根：文件位置被一个普通文件占住。
    const root = tmpRoot();
    const blocked = join(root, "run");
    // 先把 run 造成一个**文件**，mkdir/write 都会失败。
    writeFileSync(blocked, "x");
    expect(mod.writeAppServiceExit(root, { kind: "dev-server", reason: "x" })).toBe(false);
  });
});
