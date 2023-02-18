# Nostr Proxy
Push and get events to your Proxy, get results from multiple Nostr relays

## Installation

In the project directory, run:

```sh
pnpm install
```

Edit your env variables. You can use a `.env` file by copying the file `.env.example` in the root directory, or you can set your variables into your hosting provider UI.\
For `APP_KEY`, you can use the following command to generate one `node ace generate:key`

```
PORT=3333
HOST=0.0.0.0
NODE_ENV=development
APP_KEY=unique-key
DRIVE_DISK=local
SESSION_DRIVER=cookie
CACHE_VIEWS=false
PROXY_URL=wss://your-proxy.com
RELAYS=wss://relay1.com,wss://relay2.com,wss://relay.com
```

## Launch

### Development

`npm run dev` to start the app in dev mode.\
Open [http://localhost:3333](http://localhost:3333) to view it in the browser.\
Use `ws://localhost:3333` into your Nostr client.

### Production

```
npm run build
cd build
pnpm install --prod
node server.js
```

### Running tests

TODO

## Known issues
- None?

## Learn More

- [Nostr](https://github.com/nostr-protocol/nostr)
- [Awesome Nostr](https://github.com/aljazceru/awesome-nostr)

## License

This project is MIT licensed.
