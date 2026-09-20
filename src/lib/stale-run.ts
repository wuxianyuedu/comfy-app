// ── 「这一轮已经作废」的唯一出口（规范 16 §16.2.4.34）────────────────────
//
// 按形态扫描时撞出来的账：取数 effect 里那段
//
//   let cancelled = false;          // ← 本轮是否已作废
//   void (async () => {
//     const rows = await fetchX();    // ← 取数
//     if (cancelled) return;          // ← 卸载或换了参数，这一轮不要了
//     setRows(rows);
//   })();
//   return () => { cancelled = true; };   // ← 清理时置位
//
// 在**八个文件**里各写一遍（历史面板 / 素材库 / 模型库 / 任务图集 /
// 影片台 / 抽出模型选择 / 代码块 / 生成轮询），而它对三件事各判各的：
//
//   ① **作废的时机** —— 浏览器会在 effect 重跑前先跑清理，所以「卸载」与
//      「依赖变化」在 React 里本就是同一件事；但写法上分叉出「有没有接依赖」；
//   ② **读法** —— `if (cancelled) return;` 与 `if (!cancelled) setX(...)`
//      两种都在用，后者在有两个 `setState` 时把守卫抄两遍；
//   ③ **`finally` 里的读法** —— 这一处最容易写错：`setLoading(false)` 若
//      不看守卫，A 轮的 `finally` 会在 B 轮已经开始后才落地，
//      把「B 轮正在加载」错报成「加载完了」。八处里有六处写对了，
//      另外两处干脆没有 loading 态 —— 差别不是风格，是**有没有这个 bug**。
//
// 也就是说 —— **「这一轮的结果还算不算」取决于它是哪一处写的**。
// 这类差异没有报错、没有告警，tsc / eslint 也都不看（两种写法都合法）。
//
// ## 它表达的是「非失败状态」
//
// 这不是异常，也不是 `runAsyncAction` 的失败分支（规范 16 §16.2.4.30）：
// 「这一轮作废」是**正常结果**，只是它的结果不该写进界面。因此它不走
// `catch`、也不报任何提示 —— 这正是 §16.2.4.30 里 `use-history-panel`
// 那条 P27 豁免的成因（`runAsyncAction` 表达不了这件事）。
//
// ## 收什么、不收什么
//
// **收**：作废判据（`isStale()`）、按轮次提交（`commit`）、清理时作废
// （`dispose()`）。
// **不收**：怎么取数（归各自的 domain client）、作废后要不要重试
// （那是调用处的域判据）、`AbortController`（真正中断网络请求是另一件事，
// 见文末）。

/**
 * 一轮取数的作废守卫。
 *
 * 三个方法各对应上面那三件事：`isStale` 是判据、`commit` 是「按轮次提交」、
 * `dispose` 是清理。
 */
export interface StaleRunGuard {
  /** 这一轮是否已经作废（卸载、或同一容器上又开了一轮）。 */
  isStale: () => boolean;
  /**
   * 把这一轮产生的写入提交进去 —— **作了废就整段跳过**。
   *
   * 用它就不必在每个 `setState` 之前各抄一遍 `if (cancelled) return;`，
   * 也让「哪些写入属于这一轮」在代码上成为一个整体（一次 `commit` 是
   * 一个原子的「这一轮的结果」）。
   */
  commit: (write: () => void) => void;
  /** 作废这一轮（effect 清理里去调）。 */
  dispose: () => void;
}

/**
 * 就地开一把守卫（给 `useEffect` 用）。语义就是那段样板里的 `let cancelled`，
 * 但读法只留一种（`commit` / `isStale`）。
 *
 * 典型形态：
 *
 * 在 effect body 里 `const guard = beginStaleRun();`，异步回调里用
 * `guard.commit(() => setRows(rows))`，清理里 `return () => guard.dispose()`。
 * 失败分支同理 —— `guard.commit(() => setError(...))`：**卸载后到达的失败
 * 不该往界面上写任何东西**（包括错误文案与空列表）。
 */
export function beginStaleRun(): StaleRunGuard {
  let stale = false;
  const isStale = () => stale;
  return {
    isStale,
    commit(write) {
      if (!stale) write();
    },
    dispose() {
      stale = true;
    },
  };
}

/**
 * 为什么不用 `AbortController` 顶替本出口
 * ------------------------------------
 * 真正把网络请求中断掉（而不只是丢弃结果）需要在**每一层**都传 `signal`：
 * 域客户端、`fetch`、以及 tRPC 的调用选项 —— 而八处落点里有一半走的是
 * tRPC 客户端与 `EventSource`，它们的取消语义各不相同。本出口管的是
 * **「结果还要不要」**这一侧：它与「请求有没有被真正中断」是两件事，
 * 且前者是这八处**共同**欠下的那一条（后者各自都有）。
 * 需要真中断的落点（如 `use-generate` 的轮询）可以在本出口之上自己再传
 * `signal` —— 两者不冲突。
 */
