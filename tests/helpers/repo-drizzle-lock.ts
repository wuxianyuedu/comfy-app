/**
 * 「真仓库的 `drizzle/`」的跨进程独占锁（规范 §11.19.2 那一族的补丁）。
 *
 * 为什么需要它：`tests/db-migrate-noninteractive.test.ts` 判「前提不成立」那一档时，
 * 唯一的造法就是**把真 `drizzle/` 挪开**（被测脚本的迁移目录按 `root/drizzle` 写死，
 * 换不了落点）；而 `tests/db-migrate-equivalence.test.ts` 与「绝对库真的落表」那两条
 * 要靠**真 `drizzle/` 在场**才能跑。两个文件在不同 worker 里各跑各的 ⇒
 * 一个的重命名窗口就是另一个的 `beforeAll`：实测表现是
 * `Test Files 2 failed / Tests 1 failed` ——  equivalence 那份**一条断言都没红**、
 * 整个文件在 `beforeAll` 里挂掉，话术是「没有可应用的迁移」，
 * 而读日志的人第一反应是「迁移集坏了」。
 *
 * 锁的三条口径：
 *   1. **独占**：拿到锁的人做完自己的事再放，别人在门外等（不是「等一下再试运气」）；
 *   2. **等不到就红，并点名占用者**：不许把它读成超时然后重跑碰运气（§11.13 那条）；
 *   3. **主家没了就回收**：进程崩溃留下的锁不会把后来每一次运行都顶死 ——
 *      按 owner pid 判活，死的才夺（不能只看锁的年龄：机器时钟会跳、上一轮也可能只是慢）。
 *
 * 落点在 `.next/`（已被 gitignore 覆盖），所以锁本身不会把工作树弄脏；
 * 也不放 `os.tmpdir()`：那里跨检出（多个 worktree 会互相误挡）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const LOCK_DIR = path.join(ROOT, ".next", "drizzle-exclusive.lock");
const OWNER_FILE = path.join(LOCK_DIR, "owner");

/** 等待预算：最长的那份文件（等价性那组两次真起 drizzle）实测约 80s，给 5 倍余量。 */
const ACQUIRE_TIMEOUT_MS = 420_000;
const POLL_MS = 200;

function ownerText(): string {
  try {
    return readFileSync(OWNER_FILE, "utf8").trim();
  } catch {
    return "(读不到 owner)";
  }
}

/** owner 进程还活着吗？读不出 owner 时按「活着」处理（宁可等，不误夺别人的锁）。 */
function ownerAlive(): boolean {
  const pid = Number.parseInt(ownerText(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    /* SAFETY: 类型断言已复核 */
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * 取独占锁，返回释放函数（**必须**在 `afterAll` 里调用，否则同文件的后续用例会被自己挡住）。
 *
 * @param label 谁在拿（写进 owner 文件，超时话术里点名用它）
 */
export async function acquireRepoDrizzle(label: string): Promise<() => void> {
  const started = Date.now();
  let reclaimed = 0;
  for (;;) {
    try {
      if (!existsSync(path.dirname(LOCK_DIR))) {
        mkdirSync(path.dirname(LOCK_DIR), { recursive: true });
      }
      mkdirSync(LOCK_DIR);
      writeFileSync(OWNER_FILE, `${process.pid} ${label}`);
      return () => {
        rmSync(LOCK_DIR, { recursive: true, force: true });
      };
    } catch (error) {
      /* SAFETY: 类型断言已复核 */
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      if (!ownerAlive()) {
        // 主家已经没了：夺过来重试一次（只认 ESRCH，不认「等太久了」）。
        reclaimed += 1;
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > ACQUIRE_TIMEOUT_MS) {
        throw new Error(
          `拿不到真仓库 \`drizzle/\` 的独占锁（等了 ${Math.round((Date.now() - started) / 1000)}s，` +
            `回收过 ${reclaimed} 次陈旧锁）。占用者：${ownerText()}；本方：${label}。` +
            "\n  这不是超时类抖动，别靠重跑碰运气 —— 要判的是「谁在该等的这一段里改了 `drizzle/`」：" +
            "挪开真迁移集的用例与需要真迁移集在场的用例必须串到同一把锁上。",
          { cause: error },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}
