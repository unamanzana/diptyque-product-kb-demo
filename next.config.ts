import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.diptyque-cn.com",
        pathname: "/media/**",
      },
    ],
  },
};

export default nextConfig;
