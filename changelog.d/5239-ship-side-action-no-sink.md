## Fixed

- **`pnpm ship` 的单件动作不再覆盖后台流程的活快照**（ISSUE #5239）：`main()` 里
  `ship-result.json` 的「要不要落盘」此前手抄了一份单件动作白名单，漏了 `--find-issues`
  等较新加的动作。于是在后台流程等 CI（`status=running`）期间跑一次查重，单件结论就把
  活快照覆盖掉，`ship:wait` 会把旧结论当终态、等错对象。现在落盘开关直接复用
  `ship-args.mjs` 的 `singleActionSettled()` —— 与收尾那句「单件动作完成」同一份判定，
  两份维护面收成一份，新增单件动作不会再漏。`--find-issues` / `--screenshot-reply` /
  `--edit-issue` 三个点名动作逐枚补了「收口不改写 running 快照」的实测用例，
  `singleActionSettled` 的旗标面用例也逐枚列全。
