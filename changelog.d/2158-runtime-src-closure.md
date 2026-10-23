## Fixed

- **「产物里被剔掉的 90 个 `src/` 文件，运行期若有人 import 其中之一会怎样」有判据了** ——
  ISSUE #2158 第 7 条那一问。此前 `RUNTIME_SRC`（随包的 `src/**` 逐文件白名单）只有
  「不在这个清单里的不许进产物」那一侧（`check-standalone-contents.cjs`），**没有一格在看
  「该留的留了没有」**：清单是手写的，漏登记的表现是桌包启动即 `ERR_MODULE_NOT_FOUND`，
  而用户只看得到「双击没反应」。
  实测补上这一格之后读数：从 `RUNTIME_SCRIPTS` **全部** `.mjs`（38 份）出发可达 `src/`
  **61 个**，其中 **58 个**是 `src/lib/comfyui/host-runtime.ts` 那一支 —— 而那一支是
  **构建期被打进预编译件** `scripts/executor-host.runtime.mjs`（产物里 1505 KB）的：
  `executor-host.mjs` 的 `loadRuntimeGraph()` 有两条分支，有那件 bundle 就 import 它，
  没有才 `import("tsx/esm/api")` 后加载 `.ts`（dev 兜底，`tsx` 是 devDependency、不随包）。
  减掉这一支之后**净 3 个 = `RUNTIME_SRC` 逐字相等**（`kill-process-tree.ts` 与它的闭包
  `executable-resolve.ts` / `platform.ts`）⇒ **今天不缺件**，这一格的价值是以后新增时
  当场拦下。
  落成：
  - 判据 `tests/standalone-runtime.test.ts` 那条闭包的**入口面**从「硬编码的 3 份文件」
    换成 `RUNTIME_SCRIPTS` 全部 `.mjs`（原来第 4 份随包脚本 import 一份新的 `src/*.ts`
    时它一个字都不会说）；顺 `.ts` 自己的 import 走到底（ISSUE #1961 那条链）；
    剥掉整行注释（JSDoc 里点名的路径不是运行期依赖）。
  - 新增 `PREBUNDLED_SRC_ROOTS`（`standalone-private-inputs.mjs`，与 `RUNTIME_SRC` 同一处
    单一实现）：声明「构建期已打进预编译件的那一支」，闭包判据减掉它。不减的话「运行期
    真的会读的」会被算成 61 个，那条判据要么红得没道理，要么被人改成放宽清单而失去意义。
  - 两条反退化断言（入口面 > 10、被排除那一支 > 10）：这两面任一空掉时，那条「相等」
    会静默变成「什么都没漏」—— 而清单判据最危险的失效形态正是那一种。
  - 变异验过三回（排除项空掉 / 清单漏一份 / 清单多挂一份）⇒ 三次都红。
    规范 §7.3 同批订正（原写「`RUNTIME_SRC` 只放行那一个文件」，实际是三份）。
    （ISSUE #2158）
