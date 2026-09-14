## Fixed

- **生成参数取值收敛到中央实现，修掉「空串被解析成 0」的静默错值（ISSUE #535）**：`strParam` / `numParam` 这对纯取值函数此前被逐字抄了三份（`ShotStudio.tsx` 视图、`hooks/use-workshop-pipeline.ts`、`lib/workshop/character-portrait-client.ts`），连缺省值 `28 / 7 / "euler_ancestral" / "normal"` 也各写一遍。现在收敛到 `src/lib/workshop/param-coerce.ts`（`paramString` / `paramNumber` / `paramInt` + `DEFAULT_GEN_PARAMS`），三条生成链路共用同一份缺省值——此前缺省值一旦要调，漏改任一份就表现为「同一次生图三个入口参数不同」，且不报错、不留日志。
  - 三份副本都用 `Number(value)` 解析数值，而 `Number("")` 是 `0` 不是 `NaN`：参数表里留了个空串（用户清空输入框）会变成 `steps = 0`（画面全黑），而不是回落到缺省值。中央实现显式拦掉空串，与 `lib/error-message` 的「空串 = 没有值」同口径。

## Changed

- **规范 §12.12 新增「跨层不许抄一份」（ISSUE #535）**：§12.7 只依赖方向、看不见「同一函数抄了三份」——三份副本之间没有 import 边，循环依赖检测与 tsc / eslint 全都放行。新增判据：无 React、无 IO、语义与名称完全一致的纯取值/换算函数只能落在 `src/lib/`；同时写明**不该合的反例**（`use-file-upload.ts` 的 `errorMessage` 签名不同，硬合会把两层兜底语义搅在一起）。
