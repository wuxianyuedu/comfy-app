## Fixed

- **standalone 产物里有一部分 `node_modules` 链接不可跟随，冒烟因此报「包找不到」而包其实在场**
  （规范 launch-and-build §7.5.1，审查台账 R8-01）：`pnpm run build` 收尾的冒烟报
  `Cannot find package 'promise-limit'`，实测形状是 —— 同一份 `.next/standalone/node_modules` 里
  68 条链接有 16 条 `lstat` 说是链接、`readlink` 拿得到文本、目标目录 `existsSync` 为真，
  但 `fs.stat()` 报 `EPERM`。四个候选解释全部被量掉：不是缺件（目标全在）、不是长路径
  （`LongPathsEnabled=1`、最长 145 字符）、不是 pnpm 的链接形状（开发树 2089 条同类链接全部可跟随）、
  不是目标形状（两条链接目标逐字相同，一条可跟随一条 `EPERM`）。病在**建链接的那一方**：
  `next build` 的追踪器写出的 reparse 数据 Node 穿不过去，而同一个文本用 `fs.symlinkSync` 就地重建
  立刻可跟随（16/16，冒烟转绿）。
  修法在产物层新增 `pnpm build` 第 2 步 `scripts/standalone-link-repair.mjs`：遍历载荷的
  `node_modules`（**不穿链接**，口径与 §7.3 的剔除侧一致），只对不可跟随的那些取**原链接文本**重建一次。
  三条取向不可回退：保留相对文本（不用 `junction`，它存绝对目标、载荷一搬走就断）；
  **可跟随的一条都不碰**（重建会换掉链接自身 mtime，而 mtime 是 `shell-gate.mjs` 那条时效判据的输入）；
  先在临时名上建、验可跟随、再删旧换上（权限不足时原链接还在，不会把产物改得比修之前更坏）。
  重建后仍不可跟随 ⇒ 退 1 并逐条点名，话术分开「目标在场但修不好」与「真缺件」两态；
  没跑过 `next build` 时报「跳过」退 0（与同链上的 `standalone-private-inputs.mjs` 同口径）。
  桌面链不受影响（`build-desktop.mjs` §载荷实体化 本来就摊平并删掉 `.pnpm`），这一层修的是
  web/standalone 形态真正会跑的那份产物，以及构建链自己在 Windows 上跑不跑得绿。
  执行者两层：`tests/standalone-link-repair.test.ts` 判决策面（夹具造不出「目标在场而穿不过去」那种链接，
  所以用注入边界钉决策，系统调用由冒烟做真机执行者），`pnpm build` 第 7 步冒烟判真机。
  同批把 §7.5 那张构建链表从「四步」订正成当前的七步（原先漏了数产物与体积账两步）。
