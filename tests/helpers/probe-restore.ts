/**
 * 「用例会改真实入库文件」那一族的还原口径：**快照原字节，不回 git 索引**（ISSUE #2593）。`git status` 分不出「探针留脏」与
 * 「本分支正在做的未提交工作」，而 `git checkout -- <文件>` 对两者一样处置 —— 实测抹掉 92 行新增。后果不对称：漏还原只是工作区脏（可修），
 * 把人的工作当探针还原则只能重放。口径：用例不许用 `git checkout --` / `git restore` 清理工作区，要还原就还原成自己拍下的快照；判据见 `tests/probe-restore.test.ts`，全文见规范 §11.16.2。
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
  remove: (abs: string) => void;
  write: (abs: string, bytes: Buffer) => void;
};

/** Windows 上刚被子进程读过的文件会短暂占用，实测 `writeFileSync` 会连抛 `UNKNOWN`。 */
const WRITE_ATTEMPTS = 8;

/** 失败原因取正文（B5 清账）：Error 用 message，其余 String 兜底。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const realProbeIo: ProbeIo = {
  read: (abs) => (existsSync(abs) ? readFileSync(abs) : null),
  write: (abs, bytes) => {
    let last = "";
    for (let i = 0; i < WRITE_ATTEMPTS; i += 1) {
      try {
        writeFileSync(abs, bytes);
        if (readFileSync(abs).equals(bytes)) {
          return;
        }
        last = "写回后读回的内容与快照不一致";
      } catch (error) {
        last = errorText(error);
      }
    }
    throw new Error(`还原写不进去（${WRITE_ATTEMPTS} 次仍失败）：${last}`);
  },
  remove: (abs) => {
    rmSync(abs, { force: true });
  },
};

/** 拍下这些路径**此刻**的字节（不存在记成 `null`）。在任何探针动手之前调用。 */
export function snapshotPaths(
  absList: ReadonlyArray<string>,
  io: ProbeIo = realProbeIo,
): Map<string, SnapshotEntry> {
  const snap = new Map<string, SnapshotEntry>();
  for (const abs of absList) {
    snap.set(abs, io.read(abs));
  }
  return snap;
}

/**
 * 把每份文件还原成**快照里的那一份**：快照是脏的（本分支正在做的活），与 `git checkout --` 的差别正是还原后**仍是那份脏**，只有探针动过的几格被写回。
 * 返回的 `failed` 由调用方判红 —— 红里要点名「是哪一份、为什么」，不能只说「工作区不干净」。
 * @returns `restored` 真被改回去的路径；`unchanged` 当前已等于快照的（多数情况）；`failed` 还原没做成、人必须去看的路径 + 原因。
 */
export function restoreToSnapshot(
  snapshot: ReadonlyMap<string, SnapshotEntry>,
  io: ProbeIo = realProbeIo,
): {
  failed: Array<{ abs: string; why: string }>;
  restored: Array<string>;
  unchanged: Array<string>;
} {
  const restored: Array<string> = [];
  const unchanged: Array<string> = [];
  const failed: Array<{ abs: string; why: string }> = [];
  for (const [abs, want] of snapshot) {
    let now: SnapshotEntry;
    try {
      now = io.read(abs);
    } catch (error) {
      failed.push({
        abs,
        why: `读不到当前内容：${errorText(error)}`,
      });
      continue;
    }
    if (sameBytes(now, want)) {
      unchanged.push(abs);
      continue;
    }
    try {
      if (want === null) {
        io.remove(abs);
      } else {
        io.write(abs, want);
      }
      restored.push(abs);
    } catch (error) {
      failed.push({ abs, why: errorText(error) });
    }
  }
  return { restored, unchanged, failed };
}

/** 字节级比较（`null` 只与 `null` 相等 —— 「本来不存在」与「空文件」是两种状态）。 */
export function sameBytes(a: SnapshotEntry, b: SnapshotEntry): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.equals(b);
}
