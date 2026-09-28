## Changed

- **桌面包（standalone）的分发口径收到「不要设这个开关」**（P3 §5 第 2 期 · Phase 3-E1，ISSUE #1169）。`README.md` 的灰度那句与 `docs/guide-executor-host.md` 的「桌面包」段原先写的是「产物不含 src/lib 执行链与 tsx，所以 host 在桌包里跑不起来」；3-E1 之后这句不再成立（运行时图已随构建进产物）。新口径按**实测的两层区别**写：产物里跑得起来，但**没有拉起者**——拉起动作在编排器第 6.5 步，而 standalone 形态由壳直接起内嵌 `server.js`、不经过编排器。所以灰度仍限 dev，桌包里保持不写 `COMFY_EXECUTOR`（= inline），直到 ISSUE #1216 落地。
  - 排障判据同步换形：`docs/standards/launch-and-build.md` §5 的「`executor-host` boot FAILED」那一格改成产物态的真因（缺预编译件 = 旧构建；externals 解析不到 = 裁剪 `node_modules` 缺那三个包，两条都由 `pnpm build` 收尾冒烟当场拦），并新增一格「桌包里设了 host、`log/services/executor-host.log` 里连 `boot pid=` 都没有」= **不是起不来，是没人起**；表现是任务被写成 host 归属后安静留在队列（ISSUE #1204 之后回收器不再判死它），状态栏排队数只涨不落。
  - 同批新增规范 [launch-and-build §7.5](../docs/standards/launch-and-build.md)，记录构建链四步的顺序判据、external 名单的取舍、`server-only` 桩与 `createRequire` banner 这两处不改就静默炸的细节，以及四层门禁各自管什么。
