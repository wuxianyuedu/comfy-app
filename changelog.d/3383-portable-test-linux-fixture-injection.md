## Fixed

- `package-desktop-portable` 测试的 `fixture("linux")` 两用例在 Windows 本机恒红（#3383）：
  判据注入与夹具**成对**进 fixture 的返回值（`platform` + `resolveShellExe`）——
  此前 `resolvePlan` 的 `platform` 缺省落本机（定 sidecar 落包名）、壳的解析走
  `defaultShellExe` 的本机平台判据（找 `app.exe`、linux 夹具只有 `app`），
  本机平台与夹具平台不同就恒红；用例展开 `io` 字段即拿夹具当「那台机器」。
