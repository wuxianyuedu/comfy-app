## Fixed

- **`scripts/comfyapp-open-folder.ps1` 的允许根不再是一条带平台分隔符的字面量**
  （ISSUE #1358，接 #1348 的收口）：

  这条根原先写成 `Join-Path $PSScriptRoot "..\generated"` —— 一条**拼好的**、带
  Windows 分隔符的相对路径。`tests/artifact-layout-single-source.test.ts` 的跨语言
  成对判据要把它解析成绝对路径才能与 `generatedRoot()` 比，而 `path.resolve` 只在
  Windows 上把 `\` 当分隔符：POSIX 上整串被当成**一个文件名**，得到
  `<repo>/scripts/..\generated`，与 `<repo>/generated` 永不相等 —— 这条判据在
  Linux / CI 上**恒红**，而它在固定结构守护清单里，等于从 `master` 分出的每个提交
  都落不了地（复算与归属见 §13.6.2）。

  #1348 当时的补法是「解析前把 `\` 全换成 `/`」。那让判据绿了，但**没解决问题的根**：
  它把「这段字面量属于哪一端」变成了判据内部的一次猜测，判据与平台绑定这件事只是
  被藏进了 `replace` —— 同一份写法换个人再抄一遍，红还是会回来。

  真正关掉它的方式是让那段字面量**不再带分隔符**：允许根拆成 `".."` 与 `"generated"`
  两段，`Join-Path` 用宿主自己的分隔符去拼；判据也按段取、按段解析
  （`path.resolve(scriptsDir, ...segments)`），两端结论逐字相同。嵌套 `Join-Path`
  而不是 `-AdditionalChildPath`，因为后者要 PS 6+，本文件声明的是 `#Requires -Version 5.1`。
  `..` / `generated` 两个名字仍从同一处布局定义来（判据另一侧比的就是
  `generatedRoot()`），所以「产物布局只有一处定义」这条不变。

  **判据里新增一条反证**：各段必须**不带分隔符** —— 谁把 `..\generated` 那种拼好的
  字面量写回去，当场红并点名要拆成各段，而不是等 CI 上以一个看不出原因的不相等失败。
  反向验证过：把 `.ps1` 临时改回旧写法，这条与成对判据一起红。
