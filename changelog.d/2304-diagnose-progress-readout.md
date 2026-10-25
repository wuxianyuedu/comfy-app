## Added

**`--diagnose` 对「还在跑」的那一跑，终于说得出它跑到哪儿了**（ISSUE #2304）。

之前是**同一个事实两个读者面**：轮询那行带格子进度（`…/pending/0-1+30/37`），而
`--diagnose` 只念一句「没有结论（还在跑）· 下一动作：等它跑完再读一次」。看诊断的人只能去翻
原始 JSON —— 而那层嵌套（`data.pipelinesStatus.<sn>-001.stages[]`，**不是** `data.stages`）
读错一次，就会把「在推进」念成「一格都没起」（本轮现场错过一次，之后自己纠正）。

- `progressReadout(json, sn)`（`ci-build-readout.mjs`）：一次遍历同时给出**签名**与在飞格 ——
  签名仍只有 `ship-build.mjs::buildSignature` 一个算法，不另数一遍计数；
  `formatOutcome` 的 running 那一支复用它，多打两行（进度 + 在飞；没给 `json` 就少念那两行，
  旧行为与判定一字不变）。
- 「**没推进**」要连续两眼才念得出：基数落在 `.git/comfy-diagnose-last/<sn>.json`
  （按构建号分文件、不入库）。三件同时成立才念「疑似派发未出勤」：签名不变 + 间隔
  ≥ `DIAGNOSE_STALL_MINUTES`（10 分钟）+ 此刻没有一格在飞 —— 缺一件就仍念「在推进 / 还在跑」，
  那是 #2184 与 #2172 记过的同一族误判（「与正在长跑同形」）。念出来时把出口点名成
  `pnpm ship --rerun-ci`，并如实说平台**不给执行体归属**（`runner` / `npc` / `node` / `agent`
  字段不存在或为空 ⇒ 分不出「排队」与「派发丢了」）。**退码不动**（还在跑仍 `2`，不改成红）。
- 用例：`tests/ci-build-readout.test.ts` 三格（签名与 `buildSignature` 逐字相等、
  `start` 记在飞且不计入完成、取不到原值不抛）+ 两格（给 json / 不给 json 的差）；
  `tests/ship.test.ts` 的 `stallReadout` **五条分支**各钉一格，含「有格在飞时不许念停滞」与
  「未到阈值先不下判断」。两文件合计 **278 passed**；`tsc --noEmit`、`eslint` 干净。
- 规范 §13.10.13 与 project Skill `ship` 第 12 条同步（`docs/generated/**` 镜像同批重生成）。
