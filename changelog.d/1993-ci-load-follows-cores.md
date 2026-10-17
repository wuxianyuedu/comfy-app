## Changed

- **平台侧的并发不再写死，改成按现场核数算**（ISSUE #1993 / 规范 §13.5.21）：
  用户问的是「runner 配置可以控制负载吗」—— 答案是不能：`runner.cpus` 在自托管节点上
  官方明写「配置无效」（所以 `.cnb.yml` 刻意不声明它），`docker.image` 那条路也不存在，
  平台也不给「同时跑几条」的旋钮。仓库侧唯一还兑现得了的动作是**让每一档按现场的核数
  自己收敛**。
  新增 `scripts/ci-load.mjs` 作为这件事的**唯一出处**：`CNB_CPUS` → `os.availableParallelism()`
  → 兜底读核数，按「一个 worker 至少吃 4 核」折算（16 核 ⇒ 4，与 §13.5.3.8 的实测一致），
  人还能用 `COMFY_CI_MAX_WORKERS=1` 再压一档（只调并发、不动任何判据）。
  `scripts/full-suite-run.mjs` 的 `planRun()` 接上它 —— **并发不进 `extra`**，
  因为进了 `isWholeTrackRun()` 会把每一次跑都判成「不是整档」，记账通道会整个失效。
  `生产构建` 刻意**没有**旋钮：`next build` 的 worker 数由构建器自己定，
  `NODE_OPTIONS` 改的是内存上限不是并发，拿它冒充降载就是换一个东西。
  判据：`tests/ci-load.test.ts`（读取顺序 / 换算方向 / 人的出口）+
  `tests/daily-tracks.test.ts`（钉形状不钉数字）。

## Removed

- **两处空转的 stage 收窄**（ISSUE #1993，判据一字未改）：
  `格式化提交分离`（判据本体是逐文件跑 prettier，一份图 / 一个 yaml 的提交连文件都
  列不出来）与 `端口推导跨语言一致性`（域是四侧实现 + 一份向量，一个都没碰时不可能变）
  登记进 `INCREMENTAL_GATES`；本地钩子那一步同批接 `--staged`（面由
  `gate-scan-read.cjs` 新增的 `discernRoots()` 现算，不手抄会漂的目录名单）。
  ⚠️ 一个刚踩到的坑：`isUnderAny()` 判的是 `rel.startsWith(dir + "/")`，
  所以根名**不能带尾斜杠**（`src/` 会变成 `"src//"`、永不命中 —— 面上明明有源文件
  也被跳过，读数还写着「0 个落在 N 条根内」）。`tests/check-reformat-only.test.ts`
  新加的一组用例**真起脚本**判这条，不是数清单里有几个元素。
