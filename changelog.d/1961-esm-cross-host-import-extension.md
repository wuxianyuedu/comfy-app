## Fixed

- **平台侧 E2E 1 秒退的 `ERR_MODULE_NOT_FOUND`：跨宿主的 `.mjs` import 到了一份 `.ts`
  却写的是「省略扩展名」的形态**（ISSUE #1961）：

  ```
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module
    '…/workspace/src/lib/process/executable-resolve'
    imported from …/src/lib/process/python-candidates.ts
  ```

  机制一句话：**Node 的 ESM 解析器不补扩展名**。本仓 TS 侧的惯例是省略
  （`from "./executable-resolve"`），而 `.mjs` 静态 import 一份 `.ts` 时说明符**必须**
  带 `.ts`。于是「同一个模块被两侧 import」时只有一种写法在运行时成立 —— 而**这一格
  本地跑不出来**：`tsc` 与 Vite 都会替调用方补扩展名，只有平台侧那条路（生产构建后
  真跑 e2e）会让 Node 的 ESM 解析器把整条链加载一遍。实测读数：
  **30 个 stage 全绿**（含第一次跑通的 `单元测试` 791s 与 `生产构建` 125s），
  唯独 `E2E 关键流程` 1.0 秒退。

  修法不是「把某一行补上扩展名」—— 那样只是把同一个坑留给下一条边。判据躲进一个
  **零 import 的叶子模块** `src/lib/process/platform.ts`（只有 `isWindows`），
  两种宿主各自 import 它：TS 侧照旧省略扩展名，`.mjs` 侧写带 `.ts` 的形态。
  `executable-resolve.ts` 保留 `isWindows` 的 re-export，既有调用点一个都不用动。

## Added

- **`tests/esm-cross-host-imports.test.ts`**（进固定清单）：判两件缺一不可的事 ——
  ① 能被 `.mjs` 直接加载的那几个地基层模块**是叶子**（依赖闭包封闭、说明符带 `.ts`）；
  ② **把每个 `.mjs` 宿主真 `import()` 一遍** —— 这是本地**唯一**能照出上面那条
  `ERR_MODULE_NOT_FOUND` 的判据（`tsc` / `vitest` 都照不出来）。反向复算：
  把那一行改回不带扩展名，判据当场点名。

- **四份「手抄那条链」的夹具改成按链抄**：`tests/linux-env-bootstrap.test.ts` /
  `tests/dependency-audit.test.ts` / `tests/check-reformat-only.test.ts`（临时仓库里
  少一份就在**加载阶段** `ERR_MODULE_NOT_FOUND`，红出来的样子与那些门禁本身无关）、
  以及 `scripts/check-standalone-contents.cjs` 的 `ALLOWED_SRC_FILES`（它自己的第二条
  判据当场点名了这次漏登记）。这几处此前都是「一份一份列」，而**列的是一份文件、
  不是一条链** —— 链长一节，它们就静默地抄成一个点。

- **`tests/standalone-runtime.test.ts` 的随包清单判据现在跟着链走**：原先只数
  「脚本直接 import 的那一层」，被它 import 的模块自己再 import 的东西数不到 ——
  而逐文件放行的语义是「一个都不能少」。实测踩过：`executable-resolve.ts` 多了个叶子
  `platform.ts`，上面那层数字一个没变，而产物里少一份等于桌包启动即断。
  同批把 `platform.ts` 登记进 `RUNTIME_SRC`。
