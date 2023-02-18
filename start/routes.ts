import Route from '@ioc:Adonis/Core/Route'
import Env from "@ioc:Adonis/Core/Env"
import NostrSocket from '../app/Services/WebSocketHandler'
import WebSocketHandler from '../app/Services/WebSocketHandler'
// import NostrPool from '../app/Services/NostrPool'

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