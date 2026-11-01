## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 1：`src/lib/comfyui` 清零**
  （ISSUE #2776 / #2917）：52 份 242 处逐处判空值语义（无 fixer，全手工改写）。
  可空布尔 → `=== true` / `Boolean()`；探针 base URL、PID、端口等非空域值 →
  `=== null` / `!== null` 显式比较；`unknown` 外部 JSON 卫语句
  `!x || typeof x !== "object"` → `typeof x !== "object" || x === null`
  （逐值等价：非 nullish 的 falsy 值全部落进 typeof 分支同样被拒）；
  真正的「任意真值」语义与外部 JSON 数组元素的防御性判空（类型收窄不覆盖
  运行期 null）→ 落台账禁用 43 处（oxlint 原生指令 + 逐处理由，不用
  eslint-disable：eslint 未启用该规则，会判「未使用的禁用指令」——与
  eqeqeq 批同一教训）；改写成 `!= null` 的 18 处同批带 eqeqeq 台账。
  改写全部逐值等价，运行期分支由同目录 52 份用例覆盖。
