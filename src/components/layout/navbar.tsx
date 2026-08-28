"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/workspace", label: "工作台" },
  { href: "/workshop", label: "创作工坊" },
  { href: "/models", label: "模型库" },
  { href: "/me/works", label: "我的作品" },
  { href: "/settings", label: "设置" },
];

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile menu on route change（render 阶段同步，避免 effect 级联渲染）。
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setMobileOpen(false);
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* localStorage unavailable (privacy mode / quota) — theme still applies this session */
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-white">
            <BoltIcon />
          </span>
          <span className="text-lg tracking-tight">Comfy<span className="text-primary">APP</span></span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-primary-soft text-primary" : "text-muted hover:bg-subtle hover:text-ink"
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
            className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted transition-colors hover:text-ink"
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* Mobile menu trigger */}
          <button
            onClick={() => setMobileOpen((value) => !value)}
            aria-label="打开菜单"
            className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted transition-colors hover:text-ink md:hidden"
          >
            <MenuIcon />
          </button>

          <Link
            href="/login"
            className="hidden rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover md:inline-block"
          >
            登录
          </Link>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="border-t border-border md:hidden">
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 px-4 py-3 sm:px-6 lg:px-8">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active ? "bg-primary-soft text-primary" : "text-muted hover:bg-subtle hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <Link
              href="/settings"
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-subtle hover:text-ink"
            >
              设置
            </Link>
            <Link
              href="/login"
              className="mt-1 rounded-lg bg-primary px-3 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              登录 / 注册
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
