import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@agos/shared", "@agos/api"],
};

export default nextConfig;
