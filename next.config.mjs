/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: "https", hostname: "picsum.photos" }
    ]
  },
  // Route legacy /generated/* (runtime-produced media) through the API handler
  // so it is served from disk at request time (next start snapshots public/ at
  // boot and would otherwise 404 files written afterwards).
  async rewrites() {
    return [{ source: "/generated/:path*", destination: "/api/generated/:path*" }];
  }
};

export default nextConfig;
