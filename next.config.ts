import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["emailjs"],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
