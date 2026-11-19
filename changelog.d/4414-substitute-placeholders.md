## Fixed

- 工坊 comfyui 通道：占位符替换改为「先解析成结构、再对字符串值深度遍历替换」。
  此前在 `JSON.stringify` 的文本上做裸字符串手术——prompt / negative 里带 `"`、`\`
  或换行（图像提示词里极常见）时替换结果是非法 JSON，`JSON.parse` 抛 SyntaxError，
  整次生成失败。字符串形态的模板先解析（非法 JSON 给可读错误）；非字符串字段
  原样保留。（#4414）
