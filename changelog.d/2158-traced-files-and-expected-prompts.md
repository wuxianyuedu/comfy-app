## Fixed

- **「traced files 复制失败（ENOENT）」定性了：噪声，不是产物缺件**（ISSUE #2158 第 6 条）
  —— 这一条此前是「本机有、CI 上没有、没人定性」，而它每次构建都出现两句，读数上
  与「产物真少东西」长得一样。
  现场读数（`pnpm build` 全链 exit 0，win32 本机）：
  ```
  ⚠ Failed to copy traced files for …\.next\server\app\api\agent\chat\route.js
    Error: ENOENT: no such file or directory, copyfile
    'node_modules\.pnpm\@libsql+darwin-arm64@0.5.29\node_modules\@libsql\darwin-arm64'
    -> '.next\standalone\node_modules\.pnpm\@libsql+darwin-arm64@0.5.29\…'
  ```
  ⇒ copyfile 的**源**是 `@libsql/darwin-arm64`，即 **非本平台的原生变体**：pnpm 在 win32
  上只为**本平台**装 binding，那些目录盘上根本不在。它与 ISSUE #2158 第 3 条那 4 条死链
  **同一族**（那一族已由 `76a0bcbf` 认下「非本平台的变体不是缺件」）；CI 上 0 次是因为
  CI 的 install 布局不产生这些变体链接。
  边界写进判据那一格：**哪天这条警告点名的不是非本平台变体，那就是缺件而不是噪声** ——
  「已定性」的依据是缺的那个路径属不属于本平台，不是「这句警告看着无害」。
- **生产构建那一格「预期内提示」的对照表：B 组清空了**（ISSUE #2158 第 8 条的那半）。
  原 B 组三条（build cache / Better Auth baseURL / traced files ENOENT）现在**都有定性**，
  逐条搬进 A 组，并且**每条都带一列「它不证明什么」** —— 那三列比「已修」三个字重要：
  这三条每一条都曾经是「每次构建都在、没人查」的东西，移进 A 组的依据是现场读数，
  不是「看着无害」（§13.5.23 那条「没定性的一律不许进 A 组」同样适用于把它们搬进去
  的这一刻）。B 组保留为空并写明「新提示一律先落 B 组，定性之后才准搬进 A 组」。
  （ISSUE #2158）
