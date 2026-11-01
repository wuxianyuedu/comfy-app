## Changed

`typescript/no-unnecessary-condition` 逐处取证第二批（`scripts/**` 的 spawnSync 出参族，10 份 / 24 处）：18 处「类型修好」按**实测**把 `stdout` / `stderr` 声明成 `string | undefined` —— ENOENT / 超时时它们就是 `undefined`，而 `@types/node` 按 `encoding` 声明成 `string`，所以这些 `?? ""` 一直是给运行时兜的、不是多余代码；2 处删掉真冗余条件（外层已挡掉的 `!merging &&`、必填字段上的 `?.`），1 处落账（`process.argv[1]` 那条在本行读数不可信，见 #2941）。口径未变：删条件必须有「为什么删了也不会走到」的依据，给不出来就是类型的锅。
