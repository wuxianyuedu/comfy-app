## Fixed

- **受影响用例：改名把「按旧路径读文件」的用例整条漏掉**（ISSUE #2226）。
  改动面改用 `git diff --name-status -M`（本地暂存区与平台 PR 入口同一份解析
  `changedPathsFromNameStatus`），`R` 行的**旧路径与新路径都进 roots** —— 此前
  `--name-only` 只剩新路径，而门禁自测的常态是「按路径读那个文件、又不 import」，
  改名于是把它的消费方整条抹掉，本地与平台都全绿。
- 旧路径已不在索引里时，「按路径引用」再退一档：测试代码文本里同时出现**目录**与
  **文件名**两片（`join(ROOT, "src/a", "b.ts")` 的写法）也算命中。这一档只在调用方
  给了 `tracked`（`git ls-files`）且该路径**确实已消失**时启用 —— 单看 basename 会把
  半个测试面误拉进来。
- 归因（`--attribute`）把 `tracked` 一路传进同一条判定链，`--attribute` 的数与真正
  要跑的清单继续对得上；改名事件本身在 stderr / CI 日志念一行，不是静默多跑几份。
- 判据：`tests/affected-tests.test.ts` 新增「改名」一组（R 行两侧、`C` 只收新路径、
  整串字面量、分片兜底的正反两面、归因同链），`tests/ci-affected-tests.test.ts`
  两档都改判 `--name-status -M` 并钉住旧路径经 env 递进判决链。
