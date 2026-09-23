import type { NextConfig } from 'next';

// Static export: a stage is a folder of HTML that any host can serve (stages/README.md, "Deploy").
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
