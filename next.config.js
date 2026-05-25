/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  output: "standalone",
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false, os: false };
    return config;
  },
};

module.exports = nextConfig;
