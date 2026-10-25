/**
 * `intentional-empty-commit.mjs` —— 「这次是**刻意**的空提交」这件事的唯一口径。
 *
 * ── 为什么要有它（ISSUE #2354）─────────────────────────────────────────
 *
 * `pnpm ship --rerun-ci` 的机制就是在 PR 分支上推一笔空提交 —— 平台侧 CI 是 push 触发的，
 * 而 `cnb build` 那 11 个工具里没有 PR 重跑入口（`--event` 只认 `api_trigger` 前缀）。
 * 可是 D0 里那两步读的都是**当场暂存区**，空集被它们读成「取不到判决面 ⇒ 退 2」，
 * 钩子把退 2 当失败 ⇒ **本地根本做不出空提交**，那个入口从写下那天起没有走得通的路径。
 *
 * ── 为什么是「说出来的意图」，不是「猜暂存区为空」────────────────────────
 *
 * 空暂存区有两种完全不同的来路：① 有人忘了 `git add`（该问一句），② 刻意要一笔空提交
 * 去重新派生流水线（这是它的正当用途）。**两者在索引上逐字同形**，所以判不出来 ——
 * 而猜的后果是不对称的：把 ② 当 ① 就堵死唯一的恢复路径，把 ① 当 ② 就放走一次漏 stage。
 * 因此这里只认**显式旗标**，绝不按「索引恰好是空的」去推断意图。
 *
 * ── 反滥用（这一半才是这个口子能存在的前提）────────────────────────────
 *
 *   · 旗标在场**且**索引真的是空 ⇒ 这两条判据的问题都**没有对象**（空提交不改任何文件，
 *     也就没有「改了源没带镜像」「碰了机制没跑自证」可言）⇒ 正面回答并按 0 收；
 *   · 旗标在场但索引**非空** ⇒ 旗标**当场作废**并打印出来，一切按正常判决面判 ——
 *     它不是「跳过 D0」的开关，更不是 `--no-verify` 的第二形态（那条是硬规则 7 禁的）；
 *   · 旗标不在场 ⇒ 行为与这个口子存在之前**逐字同形**（默认不放松）。
 *
 * 只有一个生产者：`scripts/ship-local.mjs` 的 `--rerun-ci` 那一格。它是**内部**信号，
 * 不是给人手敲的入口 —— 人真要为空提交绕过门禁，正确出口是先修自己的判决面，
 * 而不是去设一个环境变量（两个消费者都会打印自己那句；但钩子对成功的步骤只汇成一行，所以「这一跳带了旗标」那句由发起方
 * `ship` 在回执里转述 —— 读者看得见的那一屏在发起方那边，见规范 §13.5.5 末段与 §11.23）。
 */

/** 旗标名（只有一个生产者：`ship --rerun-ci`）。 */
export const EMPTY_COMMIT_ENV = "COMFY_INTENTIONAL_EMPTY_COMMIT";

/**
 * 这个口子此刻成不成立。
 *
 * @param {{env?: Record<string, string | undefined>, stagedCount: number}} input
 *   `stagedCount` 由调用点给（它们各自已经有取暂存集的那一条 git 调用，这里不再读一次 git）
 * @returns {{applies: boolean, note: string | null, voidNote: string | null}}
 *   `applies` = 按「刻意空提交」办；`note` = 成立时要打印的那句话；
 *   `voidNote` = 旗标与索引不一致时要打印的那句话（作废并照正常档判）。
 */
export function intentionalEmptyCommit({
  env = process.env,
  stagedCount,
}) {
  const raw = env[EMPTY_COMMIT_ENV];
  const set = raw !== undefined && String(raw).trim() !== "";
  if (!set) return { applies: false, note: null, voidNote: null };
  if (stagedCount > 0) {
    return {
      applies: false,
      note: null,
      voidNote:
        `${EMPTY_COMMIT_ENV} 在场，但暂存区有 ${stagedCount} 项 ⇒ **旗标作废**，` +
        "按正常判决面判（它只服务刻意空提交，不是跳过门禁的开关）。",
    };
  }
  return {
    applies: true,
    note:
      "这一笔是**刻意的空提交**（" +
      `${EMPTY_COMMIT_ENV}，唯一生产者是 \`pnpm ship --rerun-ci\`）：` +
      "它不改任何文件 ⇒ 这一条的问题没有对象，按「没有可判的配对」正面收（不是豁免）。",
    voidNote: null,
  };
}
