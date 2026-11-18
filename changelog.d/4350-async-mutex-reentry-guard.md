## Fixed

- **`AsyncMutex` 补同步重入护栏，文件头写死「禁止重入」契约**（#4350）：
  promise 链 FIFO 实现下，同一把锁内再调 `run` 会排在这轮自己后面等自己——
  被 `await` 即永久挂起、无任何报错。现在 `fn` 同步执行段内的再入会**同步抛错**
  （错误沿外层 `run` 透传，锁不坏死；`KeyedAsyncMutex` 同 key 同样被拦且 key
  照常回收，不同 key 互不影响）；`await` 之后的再入与正常排队在语言层面不可
  区分，按排队处理、仍靠契约与评审把关。现有使用点（saveMutex / claimMutex /
  两处 overrideFileMutex / wsMessageMutex 等）均无重入，行为不变。
  同批：`src/lib/async-mutex.ts` 文件头补重入契约，规范 §8.9② 补「锁内禁止重入」。
