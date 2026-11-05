import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * 端点：GET /api/helper/status —— 前端判断「打开目录」自定义协议助手是否可用：`platform` 为当前运行平台（win32 才支持 `comfyapp://` 注册），
 * `installerAvailable` 为项目内安装脚本是否存在；`registered` 恒为 null —— 服务端无法感知客户端是否注册（浏览器不暴露），由前端点击后的 blur 探测决定。
 */
export function GET() {
  const installer = path.join(process.cwd(), "scripts", "install-comfyapp-helper.ps1");
  return NextResponse.json({
    platform: process.platform,
    protocol: "comfyapp",
    installerAvailable: fs.existsSync(installer),
    installUrl: "/api/helper/install",
    registered: null,
  });
}
