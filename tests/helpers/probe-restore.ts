/**
 * 「用例会改真实入库文件」那一族的还原口径 —— **快照原字节，不回 git 索引**（ISSUE #2593）。
 *
 * ## 立案现场
 *
 * `tests/check-doc-references.test.ts` 的收尾网长这样：`git status --porcelain` 说这四份
 * 入库文件里哪一份脏了，就对那一份执行 `git checkout -- <文件>`。它的**前提**写在注释里：
 * 「脏 = 探针留脏了」。但 `git status` 分不出「探针留下的脏」与「这条分支上本来就在做的
 * 未提交工作」—— 处置却逐字相同。于是同一分支上正在写的文档，被一次跑测整档退回 HEAD：
 *
 * ```
 * $ pnpm exec vitest run tests/check-doc-references.test.ts …（同一棵未提交的工作区）
 * Test Files  3 failed | 1 passed      ← 红的还是「doc:check 说清单缺一格」这类自证格
 * $ git status --porcelain -- docs/
 *  M docs/generated/13-提交与-code-review.md      ← 镜像还在
 * （docs/standards/13-提交与-code-review.md 不见了 —— 92 行新增被抹掉）
 * ```
 *
 * 后果不对称：探针没还原 = 工作区脏（可修）；把工作区当探针还原 = **未提交的工作没了**
 * （只能重放）。所以这一族唯一的还原凭据必须是「**进本文件那一刻的字节**」，
 * 而不是索引 —— 索引之上的那一层正是人的工作所在。
 *
 * ## 口径（一句话）
 *
 * **用例不许用 `git checkout --` / `git restore` 清理工作区**；要还原就还原成自己拍下的
 * 那份快照。判据那一半见 `tests/probe-restore.test.ts`（数组形 / `checkout HEAD -- <路径>`
 * 字符串形 / `restore --` 三种形状各自命中），
 * 口径全文见规范 §11.16.2。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/** 快照里的一格：`null` = 拍下那一刻这份文件**不存在**（探针自己造的文件就是这一形）。 */
export type SnapshotEntry = Buffer | null;

/**
 * 落盘口（默认用真 `node:fs`）。之所以留一个注入口：这一族的回归用例要在**临时目录**
 * 上跑「进用例前就脏 ⇒ 跑完还是那份脏」这条性质 —— 拿真实工作区测它，等于为了防
 * 丢工作而先冒丢工作的风险（ISSUE #2415 对 `doc:render` 那组做的同一件事）。
 */
export type ProbeIo = {
  read: (abs: string) => SnapshotEntry;
  write: (abs: string, bytes: Buffer) => void;
  remove: (abs: string) => void;
};

/** Windows 上刚被子进程读过的文件会短暂占用，实测 `writeFileSync` 会连抛 `UNKNOWN`。 */
const WRITE_ATTEMPTS = 8;

export const realProbeIo: ProbeIo = {
  read: (abs) => (existsSync(abs) ? readFileSync(abs) : null),
  write: (abs, bytes) => {
    let last = "";
    for (let i = 0; i < WRITE_ATTEMPTS; i += 1) {
      try {
        writeFileSync(abs, bytes);
        if (readFileSync(abs).equals(bytes)) return;
        last = "写回后读回的内容与快照不一致";
      } catch (e) {
        last = /* SAFETY: 类型断言已复核 */ (e as Error).message;
      }
    }
    throw new Error(`还原写不进去（${WRITE_ATTEMPTS} 次仍失败）：${last}`);
  },
  remove: (abs) => rmSync(abs, { force: true }),
};

/** 拍下这些路径**此刻**的字节（不存在记成 `null`）。在任何探针动手之前调用。 */
export function snapshotPaths(
  absList: readonly string[],
  io: ProbeIo = realProbeIo,
): Map<string, SnapshotEntry> {
  const snap = new Map<string, SnapshotEntry>();
  for (const abs of absList) snap.set(abs, io.read(abs));
  return snap;
}

/**
 * 把每份文件还原成**快照里的那一份**。
 *
 * 与 `git checkout --` 的差别就是本单的全部内容：快照是脏的（这条分支上正在做的活），
 * 还原之后**仍然是那份脏**；只有探针动过的那几格会被写回去。返回的 `failed` 由调用方
 * 判红 —— 红里要点名「是哪一份、为什么」，不能只说「工作区不干净」。
 *
 * @returns `restored` 真的被改回去的路径；`unchanged` 当前已经等于快照的（多数情况）；
 *          `failed` 还原没做成的人必须去看的路径 + 原因。
 */
export function restoreToSnapshot(
  snapshot: ReadonlyMap<string, SnapshotEntry>,
  io: ProbeIo = realProbeIo,
): { restored: string[]; unchanged: string[]; failed: { abs: string; why: string }[] } {
  const restored: string[] = [];
  const unchanged: string[] = [];
  const failed: { abs: string; why: string }[] = [];
  for (const [abs, want] of snapshot) {
    let now: SnapshotEntry;
    try {
      now = io.read(abs);
    } catch (e) {
      failed.push({
        abs,
        why: `读不到当前内容：${/* SAFETY: 类型断言已复核 */ (e as Error).message}`,
      });
      continue;
    }
    if (sameBytes(now, want)) {
      unchanged.push(abs);
      continue;
    }
    try {
      if (want === null) io.remove(abs);
      else io.write(abs, want);
      restored.push(abs);
    } catch (e) {
      failed.push({ abs, why: /* SAFETY: 类型断言已复核 */ (e as Error).message });
    }
  }
  return { restored, unchanged, failed };
}

/** 字节级比较（`null` 只与 `null` 相等 —— 「本来不存在」与「空文件」是两种状态）。 */
export function sameBytes(a: SnapshotEntry, b: SnapshotEntry): boolean {
  if (a === null || b === null) return a === b;
  return a.equals(b);
}
