## Changed

- **ESLint 扫描范围改成白名单口径（默认不扫，只扫声明过的目录）**：「哪些文件被扫」此前是「整个仓库减去一长串忽略」—— `eslint .` 配上 30 多条 `ignores`，配置里还写着维护约定「凡在 .gitignore 里新增忽略的产物/临时目录，必须同步补进此处」。新目录要追着补，漏补一次就误报或 walk 崩。现在改由两处决定，且两处都不随业务目录增长：
  - `eslint.config.js` 顶部的 `LINT_FILES` —— 规则只对匹配它的文件生效；
  - `package.json` 的 `lint` 脚本参数 —— 显式列出要扫的目录（`src tests scripts e2e tools` + 根级 TS 配置），**不再用 `eslint .`**。
    新增目录（草稿目录 / 实验目录）默认不被扫：既不在第一处也不在第二处，不必改配置、不必往任何忽略清单里补行。
- **四个调用点收成一份命令**：`package.json` 的 `lint` / `lint:fix` / `check`、`.githooks/pre-commit` 第 7 步、`scripts/quality-gate.ps1`、`scripts/quality-gate.mjs` 统一走 `pnpm run lint`（后三者原本各自抄一份 `eslint . --max-warnings 0 --cache …`，四处参数要一起改）。`ignores` 同时从 30+ 条收成「构建产物 + 生成代码」的固定坐标，生成物 `docs/api/**` 与 `src-tauri/target/**` 一并排除。
- 实测扫描集合：改造前 **1133** 个文件 → 现在 **1125** 个，差异**只有 8 个生成产物**（Typedoc 的 `docs/api/assets/*.js` 5 个 + Tauri 构建产物 3 个），**没有任何源码文件被漏掉，也没有意外扩大范围**（`only-new = 0`）。

## Fixed

- **记录一条与直觉相反的实测结论**：`{ ignores: [<忽略所有文件的 glob>] }` 后跟 `files` 白名单的「先关掉整个世界再打开」**不成立** —— ESLint 的**全局 ignores 优先于 `files`**，被它命中的文件不会被任何 `files` 重新打开（实测报 `File ignored because of a matching ignore pattern`）。那样写等于什么都不扫：门禁全绿而实际没有任何检查，比漏报更危险。替代写法（`files` 白名单 + 命令层目录参数）与实测证据写在 `eslint.config.js` 顶部那节。
- 文件头注释里不要写出 glob 字面量：`["**/*"]` 这类写法含「星号 + 斜杠」，会在块注释里**提前闭合注释**，配置直接语法报错（`ui/use-enter-commit` 的文件头记录过同一个坑，这次在 `eslint.config.js` 上又踩了一次）。注释里改为文字描述。
