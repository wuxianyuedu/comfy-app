## Fixed

- **`tests/storybook-tsc-input.test.ts` ④ 在干净检出上必红（台账 E15 / ISSUE #1409 同族）**：
  ④ 判的是「把生成件挪走 = 新检出的形态，tsc 必须退 0」，而它只挪
  `.storybook/generated/app-origin.json` —— 干净检出上还有第二样现生成、不入库的输入，
  缺了它 `.storybook/preview.tsx` 的 `import "../src/app/globals.css"` 就是 **TS2882**。

  **根因是 `next-env.d.ts`，不是 `.next/dev/types/**`**（描述里两样被当成一件，实测分开量过）：
  那份文件头两行 `/// <reference types="next" />` / `next/image-types/global` 才把
  `node_modules/next/types/global.d.ts`（`declare module '*.css' {}` 在那里）拉进类型程序；
  而同一文件尾部那两条 `import "./.next/..."` 的目标**整目录不在时 tsc 退 0**（缺件不报错，
  `skipLibCheck` 下更静）。四种组合都量过：只有「`next-env.d.ts` 不在」会红。

  **修法不是「多挪一样」，也不是把 `.next` 纳入暂存面**（那个设计决定的前提就不成立，
  且挪 `next-env.d.ts` 会打到并发的组 A `tsc` / 组 B `eslint`，与那条「目录必须还在」的
  注释是同一个坑）。按 #1409 的同一道理——**别让判据拿自己保证不了的生成物当地基**：
  ④ 现在用 **Next 自己的导出** `next/dist/lib/typescript/writeAppTypeDeclarations.js`
  把那份环境声明现造到窄项目自己的暂存目录（零手抄声明，Next 改文件头就跟着变），
  窄 `include` 指过去。窄项目的 `exclude` 同步覆写成「仓库那份去掉 `node_modules`」——
  继承来的 `exclude` 列着 `node_modules`，会把落在 `node_modules/.cache` 下的声明
  自己挡在程序外（实测踩过，`include` 那一行成摆设）。

  **干净检出实测**：`git worktree add` 一份无 `next-env.d.ts` / 无 `.next` /
  无 `.storybook/generated/` 的检出 → 该文件 **10/10 绿**（改前同样形态下 ④ 红）。

## Tests

- 新增一条**反证**「缺那份环境声明会让 tsc 报 TS2882」：临时目录里用符号链接接上真
  `next`，量两种形态 —— 无声明 → TS2882 非零退出；补上那两行 reference → 退 0，且
  **故意让 `.next` 不存在**（钉住「悬空 import 退 0」这个事实，免得有人把它改成
  「把 .next 也造出来」而让反证依赖一件与结论无关的东西）。
- 原有那条在场证明扩了一格：`--listFilesOnly` 的清单里除三个被引方，**④ 现造的那份
  环境声明也必须点名在册** —— 只判「文件落了盘」不判「它进了程序」的话，`include`
  写错 / 被 `exclude` 挡掉都会静默空转。
- 三条反向验证各红各的（均实测）：① 把 include 改回指向仓库根 `next-env.d.ts` →
  ④ 与在场证明同时红；② 撤回 `exclude` 的覆写 → 两条同时红；③ 让声明不含那两行
  reference → ④ 红在 TS2882 上。
- 判据自己在 `node_modules/.cache` 下开的暂存目录跑完收干净（实测跑完该目录只剩
  `eslint-fingerprint.json`）。
