## Changed

- **服务端成片管线拆成三份，`orchestrator.ts` 回到文件行数上限以内**（ISSUE #1257，5-A 那笔记账的兑现）：`src/server/film/orchestrator.ts` 在 5-A 之前是 898 行（离上限只差 2 行），5-A 加 boot 续跑扫描后是 1034 行。当时**没有**把它塞进 `scripts/.file-size-baseline.json`（那等于让判据从此对它永久失明），而是记下这笔账：谁推过线谁拆。这次按 issue 里已经验过的切法下沉 ——
  - `src/server/film/film-log.ts` —— `appendFilmLog`。编排侧与合成侧都要往 `filmProject.logs` 追加行，它留在任何一侧，另一侧就得反向 import 它。
  - `src/server/film/compose-film.ts` —— `isFFmpegAvailable` + `_ffmpegOk` 闩锁、`runFFmpeg`、`composeFilm`，**以及 `syncFilmToProject` + `FilmShotClip`**。回写只被合成调用（出片之后才谈得上回写）；只搬 `composeFilm` 不搬回写，新模块就要反向引 `./orchestrator`，而编排要引合成 —— 直接成环（`check-circular-deps` 判的是 AST 上的 import，`import type` 也不算安全）。
  - `src/server/film/orchestrator.ts` 只留「剧本 → 分镜 → 建片 → 逐镜提交 → 监看」，1034 → 707 行；方向是单向一条链：编排 → 合成 → 行日志 / 纯参数拼装那两个叶子。
- **`FilmStatus` / `ShotStatus` 收成一份**（§12.12 的形态：原本在 `orchestrator.ts` 与 `src/components/studio/film-studio-config.ts` 各抄一份，两边都是同一组字面量，改一处另一处连编译期都不报错）。新载体 `src/lib/film/film-status.ts` 放在 `lib` 是因为视图层与服务端都要用、而 `lib` 是两侧共同的地基（放 `server` 会让 `components` 为了一行类型去引服务端）。config 侧改成 re-export，对外 API 一字不变；编排侧不再转发导出这两个名字（全仓 grep 确认无跨文件消费者，才不留「看着在用其实没人引」的转发出口）。

## Docs

- 指南 `docs/guides/feature-workshop-flow.md` 那条「成片合成是纯客户端」改口径：工坊内的时间线预览/导出确实是客户端，**服务端出片是另一条路** —— `composeFilm` 真起 ffmpeg 拼片 / 烧字幕 / 混 BGM，出片后 `syncFilmToProject` 把逐镜 clip 与项目进度回写来源项目（入口是 `film` router 的「重新合成」与 Agent 的 `render_film` 工具），两者互不替代。这一格 issue 里早就标着「改的时候一并核」，这次一起做了。
- ADR **§22** 记本刀：为什么当时不塞基线、三条切法与两条走不通的路、连带改到的调用点（router 两处动态 import、用例导入拆分、仓储桩不用复制），以及门槛为什么不升不降。

## Tests

- 判据不变、只换入口：`src/server/film/orchestrator.test.ts` 的 `composeFilm` / `syncFilmToProject` 改从 `./compose-film` 导入（20 条判决面用例一字不改地继续跑绿 —— 搬的是代码位置，不是行为）。
- 覆盖率按新形状重量过：`src/server/film/**` 实测 64/76.7/64/55.6（分母没变，同一批判决换文件住），门槛保持 30/50/35/25 **不升不降**；`src/lib/film/**` 里新增的 `film-status.ts` 是纯类型文件（v8 记 0/0，目录聚合仍 100），那边 100/90/100/90 不动。
- 结构门禁：`check-file-structure.cjs --strict` 现在只剩工坊线的 `workflow.ts`（944 行）超限 —— 那是别人的账，本刀不替它放宽判据；`check-circular-deps` 0 组、`check-dead-exports` 0 个、`check-code-duplication` 0 对。
