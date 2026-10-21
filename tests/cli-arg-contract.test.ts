/**
 * 破坏性入口的参数契约（`scripts/cli-arg-contract.mjs`）—— 判据本身。
 *
 * 立案现场见 ISSUE #1956 / #2096：两个默认**写库**的入口原先一句 `argv` 都不读，
 * `--dry-run` 于是被当成「没有参数的那一次调用」，库照改、账照记、还退 0。
 * 两个入口各自那条「真的没落库」的判据在
 * `tests/db-push-noninteractive.test.ts` 与 `tests/db-migrate-noninteractive.test.ts`，
 * 本文件只判这一份共用件 —— 它现在有两个调用方（§12.18），所以值得独立钉。
 *
 * 判的是**形状与方向**，不判具体话术：正文里该写哪句因果只有入口自己知道，
 * 这里负责的是「认不出就别作动」与「认得的不得被一起拦」。
 */
import { describe, expect, it } from "vitest";

import { rejectUnknownArgs } from "../scripts/cli-arg-contract.mjs";

/**
 * 用注入的 `fail` 收正文：`blocked` 是「拦没拦」，`body` 是交出去的正文（没拦时为空串）。
 * 之所以不让调用方读返回值判「拦没拦」—— 退不退是 `fail` 的事，正文只是它的输入。
 */
function collect(argv: string[], recognized: string[] = []) {
  const captured: string[] = [];
  const unknown = rejectUnknownArgs({
    argv,
    recognized,
    command: "db:x",
    action: "它默认动的是**真的写库**那一句。",
    exits: ["先看会跑什么 → 读文件；", "要账 → 查账本。"],
    fail: (text) => {
      captured.push(text);
    },
  });
  return { blocked: captured.length > 0, body: captured.join("\n"), unknown };
}

describe("参数契约：认不出的拦下，认得的不许一起拦", () => {
  it("一个参数都没给 ⇒ 不拦，返回空数组", () => {
    const r = collect([]);
    expect(r.blocked).toBe(false);
    expect(r.body).toBe("");
    expect(r.unknown).toEqual([]);
  });

  it("给了认不出的 ⇒ 拦，且正文把「默认动的是什么」与出口一起交出来", () => {
    const r = collect(["--dry-run"]);
    expect(r.unknown).toEqual(["--dry-run"]);
    expect(r.body).toContain("db:x 不接受参数，但收到了：--dry-run");
    // 这一句是被吞掉的那句代价，缺了它这条守卫就退化成一句「用法错误」。
    expect(r.body).toContain("它默认动的是**真的写库**那一句。");
    expect(r.body).toContain("先看会跑什么 → 读文件；");
    expect(r.body).toContain("要账 → 查账本。");
    // 一个都不认时要把「都不认」说清，别让人以为换个别的旗标就能过。
    expect(r.body).toContain("它一个参数都不认。");
  });

  it("多个未知参数一次全报出来，不是只报第一个", () => {
    const r = collect(["--dry-run", "--force", "-y"]);
    expect(r.unknown).toEqual(["--dry-run", "--force", "-y"]);
    expect(r.body).toContain("--dry-run --force -y");
  });

  it("声明了认得的旗标 ⇒ 那些放行，剩下的照样拦", () => {
    /* 这一条防的是「守卫长成无条件 fail」：入口将来开始认参数时（今天两个都认 0 个），
     * 认得的那个必须能过 —— 否则下一步就有人为了绕开它把 recognized 清空、
     * 顺手把 `--dry-run` 也「认」掉。 */
    const r = collect(["--dry-run", "--nope"], ["--dry-run"]);
    expect(r.unknown).toEqual(["--nope"]);
    expect(r.body).toContain("它认的只有：--dry-run");
    expect(r.body).not.toContain("它一个参数都不认");
  });

  it("全认得 ⇒ 一行都不报", () => {
    const r = collect(["--dry-run"], ["--dry-run"]);
    expect(r.blocked).toBe(false);
    expect(r.unknown).toEqual([]);
    expect(r.body).toBe("");
  });

  it("这一份不碰传输层：不改写调用方传进来的 argv", () => {
    /* §12.12：共享内核里不许放任何一侧的实现。退出形态（退几、打 stderr 还是
     * console.error）由两个入口各自的 `fail` 决定；本件要是顺手 `process.exit`，
     * 用例就只能靠真起子进程判它，而那一层各入口已经在判库里的事实了。 */
    const argv = ["--surprise"];
    const before = [...argv];
    const r = collect(argv);
    expect(argv).toEqual(before);
    expect(r.blocked).toBe(true);
  });
});
