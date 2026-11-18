/**
 * `async-mutex.ts` — 进程内异步互斥（唯一出口，规范 §12.18）。
 *
 * 收的是这一族缺陷（ISSUE #3832 / #3833 / #3836 的审计结论）：「先读 → 判断 →
 * 再写」的多语句序列在两次并发调用交叠时会互相覆盖 / 重复落行。SQLite 单写者
 * 只保证**单条语句**原子；把整段序列在**本进程内**串行化，正好补上这个缺口，
 * 而不必为每条链开事务或加唯一索引（写入方都在同一个 Next server 进程里）。
 *
 * 与事务的分工：能开事务的（同一执行者上的纯 DB 序列）优先开事务
 * （`db.transaction(…, { behavior: "immediate" })`，见 `saveLlmSettings`）；
 * 跨执行者 / 夹着不可入事务调用的序列用这里 mutex。两者都只在本进程内有效，
 * 跨进程的互斥要靠 DB 约束或锁文件，别用这层冒充。
 *
 * ## 重入契约（禁止重入，ISSUE #4350）
 *
 * 同一把锁上**禁止重入**：`run` 的 promise 链是 FIFO，`fn` 落定之前再对本锁调
 * `run`，内层会排在这轮**自己后面等自己**——内层一旦被 `await`，整条链循环等待，
 * **永久挂起且无任何报错**。锁内要再调别的操作时，把内层逻辑提成**不入锁**的
 * 私有函数，锁只包最外层入口；不要嵌套 acquire。
 *
 * 护栏只罩得住能**确定判定**的一段：`fn` 的同步执行段（首个 `await` 让出控制权
 * 之前）内再调 `run`，会**同步抛错**（错误沿外层 `run` 透传，锁本身不坏死）。
 * `await` 之后的续体里再调 `run`，与「另一个并发调用正常排队」在语言层面不可
 * 区分（本模块跨端共用，没有 AsyncLocalStorage 可用），因此**不抛错、按排队
 * 处理**——此时若再 `await` 内层仍是静默死锁，靠本契约与评审（规范 §8.9②）
 * 把关。护栏常开（不分 debug）：它换掉的是「永久挂起」这种最坏的失败形态。
 *
 * 队列不做上限：本锁只做进程内串行化，调用方都在本进程内、数量有限；等待预算
 * 是调用方自己的职责（规范 §8.10），不要指望这层兜超时。
 */

/** 无 key 的互斥：同一把锁上，前一个 `run` 落定之前，后一个排队等待。 */
export class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();
  /**
   * 重入护栏标记：仅在「某个 `fn` 的同步执行段正在跑」这一窗口为 true。
   * JS 单线程下，这个窗口里再进 `run` 只可能来自 `fn` 自己的同步调用链
   *（即重入）；其他并发调用方只会在 `fn` 让出控制权后（标记已复位）才进来。
   */
  private dispatching = false;

  /** 排队执行 `fn`：返回值/异常原样透传给调用方；前一个失败**不堵**后一个。 */
  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.dispatching) {
      throw new Error(
        "AsyncMutex 重入：同一把锁在 fn 落定前再次 run，会沿 FIFO 链等待自身而永久挂起。" +
          "禁止重入——把锁内要调用的逻辑提成不入锁的私有函数（见 src/lib/async-mutex.ts 文件头，ISSUE #4350）。",
      );
    }
    const invoke = () => {
      this.dispatching = true;
      try {
        return fn();
      } finally {
        /* fn 的同步段一结束（返回 promise / 抛出）就复位：此后再进 run 是
           「别的调用方排队」或「await 之后的续体」，不是可判定的同步重入。 */
        this.dispatching = false;
      }
    };
    const run = this.tail.then(invoke, invoke);
    /* 链上只记「跑完了没有」，不记失败 —— 失败已经透传给那次调用的调用方。 */
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/** 按 key 分锁的互斥：不同 key 之间不互斥（如按影片 id 各串各的日志追加）。 */
export class KeyedAsyncMutex {
  private readonly locks = new Map<string, { lock: AsyncMutex; pending: number }>();

  /** 当前驻留的 key 数（含仍有排队/进行中任务的 key）；主要用于观测与测试。 */
  get keyCount(): number {
    return this.locks.size;
  }

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let entry = this.locks.get(key);
    if (!entry) {
      entry = { lock: new AsyncMutex(), pending: 0 };
      this.locks.set(key, entry);
    }
    entry.pending += 1;
    const release = () => {
      entry.pending -= 1;
      if (entry.pending === 0 && this.locks.get(key) === entry) {
        this.locks.delete(key);
      }
    };
    try {
      return entry.lock.run(fn).finally(release);
    } catch (error) {
      /* 底层护栏同步抛错（同 key 重入）时 promise 还没建出来，finally 挂不上；
         这里补一次 release，别让 pending 计数把 key 的回收永久卡住。 */
      release();
      throw error;
    }
  }
}
