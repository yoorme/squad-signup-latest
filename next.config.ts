import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署：输出 standalone 产物，镜像体积更小
  output: "standalone",
  allowedDevOrigins: ["remote-agent.svc.cluster.local", "*.remote-agent.svc.cluster.local"],
  // 生产构建优化
  poweredByHeader: false,
  compress: true,
  // 静态页面长缓存（带 hash 的资源由 Next 自动处理）+ 基础安全响应头
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
