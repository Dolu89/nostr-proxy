# Nostr Proxy
Push and get events to your Proxy, get results from multiple Nostr relays

## Installation

In the project directory, run:

```sh
pnpm install
```

Edit your env variables. You can use a `.env` file by copying the file `.env.example` in the root directory, or you can set your variables into your hosting provider UI.

```
PROXY_URL=wss://your-proxy.com
RELAYS=wss://relay1.com,wss://relay2.com,wss://relay.com
```

## Launch

### `npm run dev`

To start the app in dev mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.\
Use `ws://localhost:3000` into your Nostr client.

### `npm start`

For production mode

### `npm run test` (TODO)

Run the test cases.

## Learn More

- [Nostr](https://github.com/nostr-protocol/nostr)
- [Awesome Nostr](https://github.com/aljazceru/awesome-nostr)

## License

This project is MIT licensed.
