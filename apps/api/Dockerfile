# Prisma 7 requires Node 20.19+, 22.12+, or 24+.
FROM node:22.14-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN npm install && npx prisma generate

COPY . .
RUN npm run build

FROM node:22.14-bookworm

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

EXPOSE 3001
CMD ["npm", "run", "start:prod"]
