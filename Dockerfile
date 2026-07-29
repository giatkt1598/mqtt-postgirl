FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
RUN npm ci
# package-lock is generated on Windows, so npm omits Rollup's Alpine optional binary.
RUN npm install --no-save --package-lock=false @rollup/rollup-linux-x64-musl@4.62.3
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
