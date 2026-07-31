# NestJS API — raw MySQL (no Prisma / no ORM)
FROM node:22.14-bookworm AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY db ./db

RUN npm run build

FROM node:22.14-bookworm

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY db ./db

EXPOSE 3001
CMD ["node", "dist/main"]
