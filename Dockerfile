# OmniCompare 生产镜像（多阶段构建）
# 构建：docker build -t omnicompare .
# 运行：docker run -d -p 3000:3000 -v ./data:/app/data omnicompare
#       或使用 docker compose up -d

# ---------- 阶段 1：依赖安装 ----------
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---------- 阶段 2：构建 ----------
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# package.json 的 build 脚本 = next build + 将 static/public 拷入 standalone
RUN bun run build

# ---------- 阶段 3：运行时 ----------
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# standalone 产物整体拷入 /app（构建脚本已把 .next/static 与 public 拷进 standalone，
# 故 /app/server.js、/app/.next/static、/app/public 一次到位）
COPY --from=builder /app/.next/standalone ./

# 数据目录（用户上传内容与清单），必须挂载持久卷
RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3000
CMD ["node", "server.js"]
