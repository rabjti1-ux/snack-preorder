# 零食预订：不需要安装任何 npm 依赖，直接用官方 Node 镜像运行
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

# 数据库和上传的图片都在这个目录，务必挂载出来，否则删除容器后数据会丢
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/server.js"]
