## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 2：`src/lib` 其余子域清零**
  （ISSUE #2776 / #2917）：100 份 274 处逐处判空值语义（无 fixer，全手工改写），
  与批 1（comfyui，PR #3008）合计 `src/lib` 全域归零。改写口径同批 1：
  可空布尔 `=== true` / `Boolean()`；非空域字符串、PID、端口 `=== null` /
  `!== undefined` 显式比较；`unknown` 外部 JSON 卫语句重排
  `typeof x !== "object" || x === null`（逐值等价）；DB json 列的 unknown 值与
  防御性判空落台账禁用（oxlint 原生指令 + 逐处理由）；`!= null` 改写同批带
  eqeqeq 台账。全部改写逐值等价，守卫承担的 TS 收窄逐处核过
  （tsc --noEmit 绿），运行期分支由各子域同目录用例覆盖。
