## Fixed

- **`scripts/git-dir.mjs` 补登进两份运行期白名单（ISSUE #2133）**：#2072 那一批把
  「本检出 `.git` 在哪」收口到 `git-dir.mjs` 并让 `launcher-core/run.mjs` 顶层静态 import 它，
  却只改了代码、没改清单 —— 于是 standalone 减法（`standalone-private-inputs.mjs` 的
  `RUNTIME_SCRIPTS`）把这份**编排器加载期必需**的模块从产物里剔了出去。表现是桌包脱离仓库
  重新编排一次时 ESM 在加载期 `ERR_MODULE_NOT_FOUND`，用户只看到「双击没反应」，而本地源码树
  齐全、一切照旧；真数产物那一档也不红，因为它按**同一份清单**数「必须有的」。唯一还看着这件事的
  执行者是 `tests/dist-artifact-hygiene.test.ts` 的「清单覆盖编排器的相对 import 闭包」，
  它把这条红照出来后挡住了每一个动 `scripts/**` 的 PR。修法照 §13.5.5 / 硬规则 17 的登记口径：
  **两份清单同批加**（`RUNTIME_SCRIPTS` 与 `check-standalone-contents.cjs` 的 `ALLOWED_SCRIPTS`
  集合相同，由同文件的「两份白名单集合相同」判着 —— 只加一处会把一条红换成另一条红），
  判据一字未改。
