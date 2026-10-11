## Fixed

- **应用端口的「仓库根」收成一处：`resolveRepoRoot()`**（ISSUE #1771）。端口按检出路径
  推导，于是「检出路径取哪个」是端口契约的另一半；此前调用点里两种口径并存 ——
  多数写 `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")`，
  而 `playwright.config.ts` / `e2e/global-setup.ts` 写 `process.cwd()`。当下二者同值，
  但 `cwd` 随调用者的工作目录走（从别处 import、或宿主先 `chdir` 之后就不再是仓库根），
  而 `import.meta.url` 锚在文件自己身上恒定不变 —— 端口推导对这两种输入会给出
  **不同端口且不报错**（实测 `chdir` 到别处后 3311 vs 3867），
  正是「同一事实两处表达」的静默分叉。
  - `scripts/app-port.mjs` 新增 `resolveRepoRoot()`（唯一出口，取 `import.meta.url`），
    `playwright.config.ts` / `e2e/global-setup.ts` 两个 e2e 侧调用点改用它；
    `e2e-run.mjs` / `dev.mjs` / `start.mjs` / `dev-launcher.mjs` / `storybook.mjs`
    里那五行自算的 `ROOT` 常量一并收口到同一处。端口解析值不变。
  - **`install-git-hooks.mjs` 有意不收**：它是 `postinstall` 入口，而 postinstall 可能
    在**部分树**（tarball 解包）里跑 —— 那时 `app-port.mjs` 未必在场，所以它必须自带
    根定位、不得长模块依赖（那条契约的执行者是
    `tests/postinstall-cross-platform.test.ts` 的「入口真跑」两例）。它是「同值但**必须**
    独立表达」，不是本条要收的那一类。
  - 判据：`tests/app-port.test.ts` 新增「仓库根收口」一节 —— 断言 `resolveRepoRoot()`
    在 `chdir` 到别处后仍返回同一个根，外加一条按形状扫调用点的防回潮门禁
    （`resolveAppPort(process.cwd())` 一律拦下）。
