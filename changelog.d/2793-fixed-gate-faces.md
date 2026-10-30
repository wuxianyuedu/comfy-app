## Changed

- **固定清单里四条「拿真子进程 / 真 git / 真渲染」的判据自测补上了输入面**（ISSUE #2793）。
  平台「受影响用例」那一格实测 106 份合计 2473.0s CPU，其中 `eslint-gate-canary` 654.2s、
  `check-commit-claims` 184.3s、`changed-scope` 93.0s、`a11y-axe-stories` 56.9s —— 近四成
  花在「业务代码怎么改都不会让判决漂」的自检上，而它们进固定清单的理由是 **import 图追不到**，
  不是「必须每次跑」。现在改 `eslint.config.js` / 被测脚本 / `src/components/ui/**` 时相应那一条
  仍在清单里；改不相干的文件时它按面缺席并**逐条点名**（`reasons.__faceSkipped`）。
  `tests/affected-tests.test.ts`（守着「增量层还在增量」的自指那一格）**刻意不开面** —— 筛它
  等于让解析器的缺陷把自己筛掉。依赖面与全局配置（`package.json` / lockfile / `tsconfig*.json` /
  `tests/setup.ts`）不写进面里：它们本身是 `WIDE_TRIGGERS`，一命中就退成整档全跑、根本到不了
  这一层筛。同批把 `tests/fixed-gate-input-faces.test.ts` 的封闭名单扩到 8 条并新增「每条按自己的
  面回来、不互相带起」，规范 §13.5.8 里写死的「4 条 / 11 例」按 #2694 的口径去掉现值、只留「什么
  该登记」的判断。
