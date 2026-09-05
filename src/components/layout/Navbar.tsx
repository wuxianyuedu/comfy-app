"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import { Menu, Moon, Sun, Zap } from "lucide-react";

const NAV = [
  { href: "/workspace", label: "工作台" },
  { href: "/workshop", label: "创作工坊" },
  { href: "/models", label: "模型库" },
  { href: "/me/works", label: "我的作品" },
  { href: "/settings", label: "设置" },
];

function SunIcon() {
  return <Sun size={18} />;
}
function MoonIcon() {
  return <Moon size={18} />;
}
function BoltIcon() {
  return <Zap size={16} />;
}

function MenuIcon() {
  return <Menu size={20} />;
}

export function Navbar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile menu on route change（render 阶段同步，避免 effect 级联渲染）。
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setMobileOpen(false);
  }

  function toggleTheme() {
    /* 主题由 next-themes 统一管理（自动持久化 + 首帧前应用，避免闪烁）。
       切换只需翻转 html 上的 .dark（attribute="class" 由 Provider 完成）。 */
    setTheme(dark ? "light" : "dark");
  }

  return (
    <header className="border-border bg-bg/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="bg-primary grid h-8 w-8 place-items-center rounded-lg text-white">
            <BoltIcon />
          </span>
          <span className="text-lg tracking-tight">
            Comfy<span className="text-primary">APP</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary-soft text-primary"
                    : "text-muted-foreground hover:bg-subtle hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleTheme}
            aria-label="切换主题"
            className="border-border text-muted-foreground hover:text-ink grid h-9 w-9 place-items-center rounded-lg border transition-colors"
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* Mobile menu trigger */}
          <button
            onClick={() => setMobileOpen((value) => !value)}
            aria-label="打开菜单"
            className="border-border text-muted-foreground hover:text-ink grid h-9 w-9 place-items-center rounded-lg border transition-colors md:hidden"
          >
            <MenuIcon />
          </button>

          <Link
            href="/login"
            className="bg-primary hover:bg-primary-hover hidden rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors md:inline-block"
          >
            登录
          </Link>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="border-border border-t md:hidden">
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 px-4 py-3 sm:px-6 lg:px-8">
            {NAV.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary-soft text-primary"
                      : "text-muted-foreground hover:bg-subtle hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <Link
              href="/settings"
              className="text-muted-foreground hover:bg-subtle hover:text-ink rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
            >
              设置
            </Link>
            <Link
              href="/login"
              className="bg-primary hover:bg-primary-hover mt-1 rounded-lg px-3 py-2.5 text-center text-sm font-semibold text-white transition-colors"
            >
              登录 / 注册
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
