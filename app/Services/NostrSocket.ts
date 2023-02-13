import "websocket-polyfill"
import { SimplePool, Event, Filter, Sub } from "nostr-tools"
import { v4 as uuidv4 } from "uuid";
import Env from "@ioc:Adonis/Core/Env"
import WsServer from "./WsServer";
import { WebSocket } from "ws";

interface CustomWebsocket extends WebSocket {
    connectionId: string
}

class NostrSocket {

    public booted: boolean

    private _relays: string[]
    private _pool: SimplePool
    private _cache: { [key: string]: string }
    private _subs: { [subscriptionId: string]: Sub }

    constructor() {
        this.booted = false
        this._relays = [...Env.get('RELAYS').split(',')]
        this._pool = new SimplePool()

        this._cache = {}
        this._subs = {}
    }

    public async boot() {
        if (this.booted) return

        await this.initRelays()
        await this.initWsHandler()
        this.booted = true
    }

    public async initRelays() {
        // Initializing relays
        for (const url of this._relays) {
            try {
                const relay = await this._pool.ensureRelay(url)
                await relay.connect()
            } catch (_) {
                // console.error(`Error while initializing relay ${url}`)
            }
        }
    }

    private async initWsHandler() {
        WsServer.ws.on('connection', (socket: CustomWebsocket) => {

            socket.connectionId = uuidv4()

            socket.on('message', async (data) => {
                try {
                    const randomSubscriptionId = uuidv4()
                    const parsed = JSON.parse(data.toString())

                    if (parsed[0] === 'REQ') {
                        const filters = parsed[2] as unknown as Filter
                        const subscriptionId = parsed[1]

                        // Close old subscription if subscriptionId already exists
                        if (this._cache[`${socket.connectionId}:${subscriptionId}`]) {
                            const oldRandomSubscriptionId = this._cache[`${socket.connectionId}:${subscriptionId}`]
                            this._subs[oldRandomSubscriptionId].unsub()
                            delete this._subs[oldRandomSubscriptionId]
                        }

                        this._cache[`${socket.connectionId}:${subscriptionId}`] = randomSubscriptionId

                        this._subs[randomSubscriptionId] = this._pool.sub(
                            this._relays,
                            [filters],
                            { id: randomSubscriptionId }
                        )

                        this._subs[randomSubscriptionId].on('event', (data: Event) => {
                            socket.send(JSON.stringify(["EVENT", subscriptionId, data]))
                        })
                        this._subs[randomSubscriptionId].on('eose', () => {
                            socket.send(JSON.stringify(["EOSE", subscriptionId]))
                        })
                    }
                    else if (parsed[0] === 'CLOSE') {
                        const subscriptionId = parsed[1]
                        const randomSubscriptionId = this._cache[`${socket.connectionId}:${subscriptionId}`]
                        delete this._cache[`${socket.connectionId}:${subscriptionId}`]

                        if (this._subs[randomSubscriptionId]) {
                            this._subs[randomSubscriptionId].unsub()
                            delete this._subs[randomSubscriptionId]
                        }
                    }
                    else if (parsed[0] === 'EVENT') {
                        const event = parsed[1] as unknown as Event
                        let pubs = this._pool.publish(this._relays, event)
                        pubs.forEach(pub =>
                            pub.on('ok', () => {
                                socket.send(JSON.stringify(["OK", event.id, true, ""]))
                            })
                        )
                    }
                    else {
                        throw new Error(`Invalid event ${data}`)
                    }
                } catch (error) {
                    console.error('Unexpected error in Socket message: ', error)
                    for (const key of Object.keys(this._cache)) {
                        if (key.startsWith(socket.connectionId)) {
                            const randomSubscriptionId = this._cache[key]
                            if (this._subs[randomSubscriptionId]) {
                                this._subs[randomSubscriptionId].unsub()
                                delete this._subs[randomSubscriptionId]
                            }
                            delete this._cache[key]
                        }
                    }
                    socket.close(3000, error.message)
                }
            })

            socket.on('close', async () => {
                for (const key of Object.keys(this._cache)) {
                    if (key.startsWith(socket.connectionId)) {
                        const randomSubscriptionId = this._cache[key]
                        if (this._subs[randomSubscriptionId]) {
                            this._subs[randomSubscriptionId].unsub()
                            delete this._subs[randomSubscriptionId]
                        }
                        delete this._cache[key]
                    }
                }
            })
        })
    }

    public async getRelays(): Promise<{ url: string, connected: boolean }[]> {
        let relays: { url: string, connected: boolean }[] = []
        for (const relayUrl of this._relays) {
            const relay = await this._pool.ensureRelay(relayUrl)
            relays = [...relays, { url: relay.url, connected: relay.status === 1 ? true : false }]
        }
        return relays
    }

    public async getStats() {
        const relays = await this.getRelays()
        return {
            connectedClients: WsServer.ws.clients.size,
            internalInfos: {
                subs: Object.keys(this._subs).length,
                cache: Object.keys(this._cache).length,
            },
            relays: {
                connected: relays.filter(relay => relay.connected).length,
                total: relays.length
            }
        }
    }

}

export default new NostrSocket()