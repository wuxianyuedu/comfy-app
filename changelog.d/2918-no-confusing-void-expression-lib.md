## Changed

- oxlint `typescript/no-confusing-void-expression` 第 1 批：`src/lib/**` 全仓清零
  （132 处 / 45 份，ISSUE #2918）。改动面只有两种形态：

  1. **箭头简写 → 块体**（127 处）：`() => doThing()` 改成 `() => { doThing(); }`。
     优先块体而不是 `void doThing()`：后者与 `eslint/no-void` 那张单（#2923）正面撞车，
     而这一类里绝大多数是「副作用回调」，块体读起来就是原意。
  2. **`return <void 调用>` → 先调用再 `return;`**（2 处：`readPgid` 的
     `return resolve(null)`、pino `logMethod` 钩子里 `return method.apply(...)`）。
     两处都逐条看过调用点：前者在 Promise executor 里、后者的返回类型声明本来就是
     `=> void`，没有任何调用方读这个值。

  剩下 3 处是"把 void 返回值直接塞进 `expect(...)`"的断言（`async-action` / `form-props` /
  `workflow-mutations` 的用例）。这一族**不能**改块体——那会把「不返回值」改成「不抛」，
  换掉被测的命题。改成 `expect(() => <调用>).not.toThrow()` 的实测依据：
  在 jest-extended 下 `expect(<void 值>)` 会退化成「收到非 thenable 就抛」的形状，
  原断言本来就测不到「返回 undefined」。

验证：单规则复扫 `src/lib/**` 0 命中；`tsc --noEmit`、`eslint`、`oxfmt --check` 通过；
受影响用例 25 份 348 条全绿。
