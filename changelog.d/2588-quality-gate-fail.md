## Fixed

- **`quality-gate.mjs` 四条失败路径不再抛 `ReferenceError: fail is not defined`**
  （ISSUE #2588，#2524 扩面那一跑揭示的真缺陷）：`fail()` 在该文件里从未被声明过
  （21fe214c 重写时把实现弄丢了），四条失败前提（PATH 取不到 pnpm / pnpm 起不来 /
  未知门禁 / lockfile 漂移）真跑进去时读者拿到的是一屏指向门禁自身的栈。
  现在补上实现，红行收进 `ci-log.mjs` 的 `renderVerdict()` 一份（§12.12，不抄第三份
  打红话的实现），提示行与退出码仍由调用点负责。脚本档 typecheck 的 4 条 TS2304
  随之清零（棘轮账面收紧 310 → 306）。
- 回归用例：未知门禁（`--mode`）真触发那一站——读到点名可选值的红话并退 2，
  且无 ReferenceError；其余三站的「名字已声明」由 typecheck 棘轮管着（两层级配）。
