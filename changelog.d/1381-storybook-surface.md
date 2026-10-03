## Added

- **组件工作台的故事「面」升成机器判据**（ISSUE #1381 续，规范 16 §16.2.3.8）。
  覆盖率台账（§16.2.3.5）只看**文件名 ↔ 故事文件** —— 一个组件只要被某份 story
  `import` 到就计一分。于是四种**构建全绿、画布也画得出东西**的漏法一个都拦不住：

  | 漏法 | 后果 |
  | ---- | ---- |
  | 故事缺 `title` | Storybook 按**文件路径**自动生成条目，落在侧栏哪个分组取决于推导规则 —— 「按 UI/Studio/Workshop 分组浏览」只在每份都写了 title 时成立 |
  | 真组件没接上 | `component:` 缺，或连的是 story 内部自造的适配件、而它里面也没那个组件 —— 画布上摆的是**别的东西**，Args 与 addon-docs 表格全空 |
  | 新写的故事没给必填 props 的 `args` | 组件在画布上读到 `undefined`（`Cannot read properties of undefined`）—— **与 §16.2.3.4 那轮踩的坑同形**：侧栏有故事、画布一片空白 |
  | 同目录两套分组前缀 | 分组靠人写 `title:` 的字符串维系，没有任何东西会告诉你漂了 |

  判据落在 `scripts/storybook-checks/story-surface.mjs`（纯函数，AST 判、不做类型分析），
  三处共用同一份实现：`tests/storybook-story-surface.test.ts`（进
  `FIXED_STRUCTURAL_TESTS`）、`scripts/storybook-check.mjs` 的 `--changed` 档、
  pre-commit 的 D 组（`run "故事面（title / 接上真组件 / 分组一致 / 必填 props 的 args）"`）。
  第四档**只挡新增**（`--changed` = 本次暂存的故事文件）：存量那 86 份的必填项多由
  「子件 + 默认值」或注入层的 `args.sourceName` 兜住，逐条补 `args` 是把 337 张画布的
  输入形状重写一遍，而逐条白名单又会变成**第二份赦免名单** —— 口径与其余棘轮的
  「只挡新增」一致。

## Fixed

- **`ui/simple-key-handler.stories.tsx` 从来没有 `title`**（判据上线第一次跑抓到）。
  它是按路径自动分组的那一类，侧栏里落不进 `UI/*` 这套分组。同批照出 `metaObjectOf`
  的一个口径问题：原先要求「`title` **与** `component` 都在」才算 `meta`，而 CSF 里
  `component` 是**可选**的（纯属性包、复合件那类故事就没有）；改成「两者有一个即可」，
  缺的那一项交给各自的判据点名。

## Documentation

- 规范 16 新增 §16.2.3.8（四种漏法 / 适配件为什么必须按「真组件有没有被用到」判 /
  第四档为什么是单向的 / 必填项怎么读）；`docs/guide-storybook.md` 的「怎么加一个
  story」与「相关」两节各补接线；`PRODUCTION-GAPS` 的 F6 同步；
  §13.1 的手跑清单与钩子同步成 `node scripts/storybook-check.mjs --changed`。
