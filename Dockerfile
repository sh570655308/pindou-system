# 多阶段构建 - 阶段1：构建 React 前端
FROM node:18-alpine AS build-client
WORKDIR /client
RUN apk add --no-cache python3 make g++
COPY client/package*.json ./
# 安装所有依赖（包括 devDependencies，因为需要构建）
RUN npm ci --no-audit --no-fund
COPY client/ ./
# 构建 React 生产版本
RUN npm run build

# 阶段2：构建最终镜像
FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev --no-audit --no-fund
COPY server/ ./server/
# 从构建阶段复制前端构建产物
COPY --from=build-client /client/build ./server/public
RUN mkdir -p /app/data/database /app/data/uploads
EXPOSE 5000
ENV NODE_ENV=production
ENV PORT=5000
CMD ["node", "server/index.js"]
