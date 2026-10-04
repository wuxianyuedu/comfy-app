## Fixed

- **`scripts/launcher-core/run.mjs` 的注释语言硬闸红（不是本 PR 引入的）**：这条
  `check-comment-language.cjs` 红（基线 0 行 = 硬闸）拦住从 `master` 分出的**每一个**提交。
  按 §13.6.2 复算：在干净的上游提交（`7b81b62a`，即当前 `origin/master`）上单跑
  `node scripts/check-comment-language.cjs` **同样命中**「新增 1 个带英文注释的文件
  （3 行）」—— 归因 `d39ee178`（`feat(log): 一次运行一包的地基…`，#1326 第 1 刀，经平台
  squash 合并、未跑本地钩子）。挡路的硬闸类就地收掉：给 `runDirName` 的 `@param {Date} at` /
  `@param {string} runId`、`copyTree` 的 `@param {string} from` / `@param {string} to`
  补上中文说明（判据在 `@param` 行没有中文、且参数名本身是英文虚词 —— `at` / `from` / `to` ——
  时会把结构行误判成英文说明）。纯注释改动，零业务语义。
