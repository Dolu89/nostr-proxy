ARG NODE_IMAGE=node:16.13.1-alpine

FROM $NODE_IMAGE AS base
RUN apk --no-cache add dumb-init curl python3 make gcc g++
RUN mkdir -p /home/node/app && chown node:node /home/node/app
WORKDIR /home/node/app
RUN curl -f https://get.pnpm.io/v6.16.js | node - add --global pnpm
USER node
RUN mkdir tmp

FROM base AS dependencies
COPY --chown=node:node ./package.json ./
COPY --chown=node:node ./pnpm-lock.yaml ./
RUN pnpm install
COPY --chown=node:node . .

FROM dependencies AS build
RUN node ace build --production --ignore-ts-errors

FROM base AS production
ENV NODE_ENV=production
ENV PORT=$PORT
ENV HOST=0.0.0.0
COPY --chown=node:node ./package*.json ./
RUN pnpm install --prod
COPY --chown=node:node --from=build /home/node/app/build .
EXPOSE $PORT
CMD [ "dumb-init", "node", "server.js" ]