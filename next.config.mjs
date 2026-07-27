/** @type {import('next').NextConfig} */
const nextConfig = {
  // 决策核心只暴露 /api/* 路由；UI/鉴权/数据库由全栈角色后续接入。
  reactStrictMode: true,
};

export default nextConfig;
