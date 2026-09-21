## Fixed

- **`src/lib/form-props.ts` 的 `textHandler<T>` 静默谎言**：单签泛型
  `textHandler<T = string>(onValue, transform = (raw) => raw as unknown as T)`
  的默认值让调用方「忘记传 transform」时，把字符串原文交给非 string 签名的回调
  —— `textHandler<number>(cb)` 会编译通过，运行时 `"42"` 字符串直接落进
  number 状态、下游 `Number.isFinite(str)` 一律 false 走 fallback、或者更糟
  直接进 SQL 落库。本模块开头自我定位是「全库唯一的 props 适配器出口」，
  「值转换是可选的」在这里就是谎言。改成两条重载：
  `textHandler(onValue: ValueHandler<string>)` 时 `transform` 可省（取到的
  原值就是最终值）；`textHandler<T>(onValue: ValueHandler<T>, transform)` 时
  **必填**，`T` 非 string 又忘传 transform 直接编译错误。实现里保留一处
  `raw as unknown as T` 兜底 —— 只在重载决议已把 `T` 锁到 `string` 的路径上
  生效，编译器已经核对过，运行时是恒等。全库现有 ~50 处调用点 `tsc` 全绿，
  没有一处真的踩坑（都是 string 或已显式给 transform）—— 修复的是**未来漏口**，
  与旧行为完全兼容。
