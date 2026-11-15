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
 */

/** 无 key 的互斥：同一把锁上，前一个 `run` 落定之前，后一个排队等待。 */
export class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  /** 排队执行 `fn`：返回值/异常原样透传给调用方；前一个失败**不堵**后一个。 */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    /* 链上只记「跑完了没有」，不记失败 —— 失败已经透传给那次调用的调用方。 */
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/** 按 key 分锁的互斥：不同 key 之间不互斥（如按影片 id 各串各的日志追加）。 */
export class KeyedAsyncMutex {
  private readonly locks = new Map<string, AsyncMutex>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let lock = this.locks.get(key);
    if (!lock) {
      lock = new AsyncMutex();
      this.locks.set(key, lock);
    }
    return lock.run(fn);
  }
}
