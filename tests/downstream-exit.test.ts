/**
 * 运行期退出也要写下结束记录（ISSUE #1692 的第二半 / 规范 §4.5.3）。
 *
 * 判据在 `scripts/launcher-core/downstream-exit.mjs` 的 `runtimeExitRecord`
 * （纯函数），这里逐分支钉死：写侧原先只挂在**就绪等待期**那条路径上，于是
 * 「服务起来之后自己没了」——用户在界面上真正会看到的「应用服务已断开」——
 * 一条记录都不会有，恢复后读回 `null`，界面只能回一句把成因猜成「手工
 * `pnpm dev`」的兜底。而双击 exe 走的恰恰是这条最常出问题、也最该有原因的档位。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type RuntimeExitInput = {
  devCode: number | null;
  devSignal?: string | null;
  port?: number | null;
  runId?: string | null;
  who: "dev" | "shell" | "signal";
};
/** 判据函数的返回形状（.mjs 侧的 JSDoc 对 .ts 消费方不可见，这里显式声明一次）。 */
type RuntimeExitRecord = {
  code: number | null;
  kind: string;
  port: number | null;
  reason: string;
  runId: string | null;
  signal: string | null;
};

const { runtimeExitRecord } = /* SAFETY: 类型断言已复核 */ (await import(
  pathToFileURL(join(process.cwd(), "scripts", "launcher-core", "downstream-exit.mjs")).href
)) as { runtimeExitRecord: (input: RuntimeExitInput) => RuntimeExitRecord };

/** dev server 以退出码非零结束。 */
const DEV_DIED: RuntimeExitInput = {
  who: "dev",
  devCode: 1,
  port: 3790,
  runId: "a1b2c3",
};

describe("runtimeExitRecord：运行期退出要不要写记录", () => {
  it("dev 先退出 → 写一条 dev-server 记录，带退出码、端口与 runId", () => {
    expect(runtimeExitRecord(DEV_DIED)).toMatchObject({
      kind: "dev-server",
      code: 1,
      signal: null,
      port: 3790,
      runId: "a1b2c3",
    });
  });

  it("原因说清「它是在运行中退出的、此后一直不可达」（不是「启动失败」）", () => {
    const record = runtimeExitRecord(DEV_DIED);
    expect(record?.reason).toContain("运行中");
    expect(record?.reason).toContain("不可达");
    expect(record?.reason).toContain("exit=1");
  });

  it("被信号结束时带上信号（Windows 上强杀与 exit 1 的排查方向相反）", () => {
    const record = runtimeExitRecord({
      who: "dev",
      devCode: null,
      devSignal: "SIGKILL",
    });
    expect(record).toMatchObject({ code: null, signal: "SIGKILL" });
    expect(record?.reason).toContain("signal=SIGKILL");
  });

  it("退出码拿不到就是 null，不拿 0 顶（0 是「正常退出」这个具体结论）", () => {
    expect(runtimeExitRecord({ who: "dev", devCode: null })?.code).toBeNull();
  });

  it("壳先退出（用户关窗 / 壳被收走）→ 不写：服务是被带走的，不是自己崩的", () => {
    /* 这一条写下去，用户关一次窗，下次启动就会读到一条「本地服务自身退出了」——
     * 把设计内行为说成故障（判据的分档理由，见 describeAppServiceExit）。 */
    expect(runtimeExitRecord({ who: "shell", devCode: 1 })).toBeNull();
  });

  it("编排器自己收到 SIGINT/SIGTERM → 不写：那是回收整树后的有序退出", () => {
    expect(runtimeExitRecord({ who: "signal", devCode: null })).toBeNull();
  });

  it("运行期这段收尾真的接上了写侧（判据抽出来了，调用点也得在）", () => {
    /* 纯函数与调用点各钉一半：函数存在但常驻段没调它，等于没写。 */
    const src = readFileSync(
      join(process.cwd(), "scripts", "launcher-core", "downstream-exit.mjs"),
      "utf8",
    );
    expect(src).toContain("export function runtimeExitRecord(");
    expect(src).toContain('who !== "dev"');
  });
});
