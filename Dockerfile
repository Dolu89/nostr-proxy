# from node
FROM node:latest


RUN curl -f https://get.pnpm.io/v6.16.js | node - add --global pnpm
RUN npm install typescript -g

WORKDIR /usr/src/app
# Files required by pnpm install
COPY . .

RUN pnpm install


EXPOSE 3000
CMD [ "npm", "run", "dev" ]
