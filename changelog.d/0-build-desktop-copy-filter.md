## Fixed

- **构建产物组装先拷后删（`scripts/build-desktop.mjs`）**：
  `cpSync(.next/standalone → static)` 曾把 docs / tests / tools / python-venv 这些
  tracing 噪声大目录**先整树拷进 static、再逐个 `rmSync` 删掉** —— 白走一遍文件复制。
  现在噪声清单同时喂给 `cpSync` 的 `filter`（连同 `node_modules/.cache`），
  复制前即排除；原 `rmSync` 循环保留作兜底（filter 生效时是空操作）。
