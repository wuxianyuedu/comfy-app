## Fixed

- 「GitHub 判决回读」格：触发表零条 run 不再一律吃满 45 分钟 —— 派发已确认时先做一次结构判定（仓库身份可查 / `pr-gate.yml` 存在且 workflow 为 active / 默认分支上的那份仍监听 `repository_dispatch`），任一证据明确「不会有 run」就当场 exit 2 并念出是哪一条；判不出则按 5 分钟短窗口收工，读数写「没找到对应 run（不是 run 未到终态）」并附判定依据。`mirror-dispatch.json` 缺失是独立一形：单独读数、同样 5 分钟短界，不并入零条 run；45 分钟预算只留给「确实读到本跑、但还没到终态」那一形，迟到 4 分钟的 run 仍会被认领（ISSUE #3153）。
