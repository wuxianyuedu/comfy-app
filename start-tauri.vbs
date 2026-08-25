' start-tauri.vbs — 无控制台窗口启动 Tauri 桌面壳
' 说明：
'   - 本脚本由 WScript 执行，不弹出 CMD/PowerShell 控制台窗口。
'   - 它调用 scripts\dev-launcher.ps1 的 -Tauri 开关，由 PowerShell
'     在隐藏窗口中启动 tauri dev，桌面窗口由 Tauri 自身弹出。
'   - 关闭 Tauri 桌面窗口后，PowerShell 进程及整棵 Job Object 子进程
'     会自动清理。

Dim fso, shell, scriptDir, psFile, psExe, envPath
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psFile = fso.BuildPath(scriptDir, "scripts\dev-launcher.ps1")

' 优先使用 pwsh 7（PowerShell Core），回退到 Windows PowerShell 5.1
psExe = "pwsh"
Set shell = CreateObject("WScript.Shell")
envPath = shell.ExpandEnvironmentStrings("%PATH%")
If InStr(1, LCase(envPath), "pwsh", vbTextCompare) = 0 Then
  ' PATH 中未明显包含 pwsh，尝试常见安装路径
  Dim candidates, c
  candidates = Array( _
    shell.ExpandEnvironmentStrings("%ProgramFiles%\PowerShell\7\pwsh.exe"), _
    shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\PowerShell\7\pwsh.exe"), _
    "powershell.exe" _
  )
  For Each c In candidates
    If fso.FileExists(c) Then
      psExe = c
      Exit For
    End If
  Next
End If

' WindowStyle=0 隐藏窗口；False 表示不阻塞，脚本立即返回
shell.Run """" & psExe & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psFile & """ -Tauri", 0, False

Set shell = Nothing
Set fso = Nothing
