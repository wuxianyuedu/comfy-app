## Fixed

- **bundle 体积预算基线认账抬高（+3.3 KB gzip / 文件数不变）** —— 这是**首次跑到
  这一步**才照出来的账，不是本次改动引入的：在它之前的所有跑次里，`生产构建` 都因为
  `单元测试` 先失败而被 `skipped`（前四跑的平台侧读数），也就是**这条判据在自托管
  路径上从来没被跑到过**。

  **归因是实测的，不是推断的**：同一份源码分别在**本分支**与**干净的 `origin/master`
  检出**上各跑一次 `pnpm run build`，两次读数字节相同 —— `gzip` 都是 **2275.4 KB**
  （基线 2272.1 KB，2026-10-14 生成，其后 32~50 次提交）。本分支不碰任何进入客户端
  bundle 的模块：改到的 4 个 `src/lib` 文件里，`reaper.ts` / `python-resolve.ts` /
  `python-candidates.ts` / `executable-resolve.ts` 全是**纯 Node 宿主**
  （`console-run.ts` 那条链，起子进程用），客户端 chunk 一个没动。

  按 §13.5.4 的例外流程认账：`node scripts/check-bundle-budget.cjs --update
  --allow-increase`，`baselineRev` 落到 `b6c3c353`，`generatedAt` → 2026-10-15。
  **文件数 221 没变**（只涨字节、没多出 chunk）。同批把产物档（`pnpm run build` +
  数产物 + `executor-host-smoke`）在本机实跑一遍记账（`scripts/.artifact-freshness.json`）。

  ⚠️ 留给下一个读到的人：这一档是**棘轮**，`--update` 不带 `--allow-increase` 会拒绝
  抬高。本条认的是「基线之后那几十次提交的累积涨幅」，**下一个人若看到它又红了，
  先按同样的办法归因**（在干净 master 上复跑一遍），别默认它是自己引入的。
