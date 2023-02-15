import Route from '@ioc:Adonis/Core/Route'
import Env from "@ioc:Adonis/Core/Env"
import NostrSocket from '../app/Services/WebSocketHandler'
import v8 from "node:v8"
import WebSocketHandler from '../app/Services/WebSocketHandler'

Route.get('/', async ({ view }) => {
  if (!NostrSocket.booted) return { message: 'Nostr Proxy is booting...' }

  const proxyUrl = Env.get('PROXY_URL')
  const relays = await WebSocketHandler.getRelays()
  const relaysCount = relays.length
  return view.render('welcome', { proxyUrl, relays, relaysCount })
})

Route.get('/stats', async () => {
  if (!NostrSocket.booted) return { message: 'Nostr Proxy is booting...' }

  const stats = NostrSocket.getStats()
  return stats
})

Route.get('/heap/:name', async ({ params }) => {
  if (!NostrSocket.booted) return { message: 'Nostr Proxy is booting...' }

  const name = params.name
  v8.writeHeapSnapshot(`heap-${name}.heapsnapshot`)
})