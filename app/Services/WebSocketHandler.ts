import { v4 as uuidv4 } from "uuid";
import Env from "@ioc:Adonis/Core/Env"
import { WebSocket } from "ws";
import WebSocketInstance from "./WebSocketInstance"
import { RelayPool, Event } from "nostr-relaypool";
import { Filter } from "@dolu/nostr-tools";
// import { SimplePool } from "./Simplepool";

interface CustomWebsocket extends WebSocket {
    connectionId: string
}

class WebSocketServer {

    public booted: boolean

    private _relays: string[]
    private _pool: RelayPool
    private _cache: Map<string, string>
    private _subs: Map<string, () => void>

    constructor() {
        this.booted = false
        this._relays = [...Env.get('RELAYS').split(',')]
        this._pool = new RelayPool(this._relays, { keepSignature: true, dontLogSubscriptions: true, noCache: true, skipVerification: true })

        this._cache = new Map()
        this._subs = new Map()
    }

    public async boot() {
        if (this.booted) return

        this._pool.onerror((err, relayUrl) => {
            console.log("RelayPool error", err, " from relay ", relayUrl);
        });
        this._pool.onnotice((relayUrl, notice) => {
            console.log("RelayPool notice", notice, " from relay ", relayUrl);
        });
        await this.initWsHandler()
        this.booted = true
    }

    private async initWsHandler() {
        WebSocketInstance.ws.on('connection', (socket: CustomWebsocket) => {

            socket.connectionId = uuidv4()

            socket.on('message', async (data) => {
                try {
                    const randomSubscriptionId = uuidv4()
                    const parsed = JSON.parse(data.toString())

                    if (parsed[0] === 'REQ') {
                        const filters = parsed[2] as unknown as Filter
                        const subscriptionId = parsed[1]

                        // Close old subscription if subscriptionId already exists
                        const oldRandomSubscriptionId = this._cache.get(`${socket.connectionId}:${subscriptionId}`)
                        if (oldRandomSubscriptionId) {
                            const unsub = this._subs.get(oldRandomSubscriptionId)
                            if (unsub) unsub()
                            this._subs.delete(oldRandomSubscriptionId)
                        }

                        this._cache.set(`${socket.connectionId}:${subscriptionId}`, randomSubscriptionId)

                        let eventsSent = 0
                        let eoseSent = false

                        let limit = 100
                        if (filters.limit && filters.limit <= limit) {
                            limit = filters.limit
                        }

                        const unsub = this._pool.subscribe(
                            [filters],
                            this._relays,
                            (event, isAfterEose, relayURL) => {
                                const { relayPool, relays, ...e } = event
                                eventsSent++
                                socket.send(JSON.stringify(["EVENT", subscriptionId, e]))
                                if (!eoseSent && eventsSent === limit) {
                                    eoseSent = true
                                    socket.send(JSON.stringify(["EOSE", subscriptionId]))
                                }
                            },
                            undefined,
                            undefined,
                            { logAllEvents: false }
                        )

                        const eoseTimer = setTimeout(() => {
                            if (eoseSent) return
                            eoseSent = true
                            socket.send(JSON.stringify(["EOSE", subscriptionId]))
                            clearTimeout(eoseTimer)
                        }, 2500)

                        this._subs.set(randomSubscriptionId, unsub)
                    }
                    else if (parsed[0] === 'CLOSE') {
                        const subscriptionId = parsed[1]

                        const randomSubscriptionId = this._cache.get(`${socket.connectionId}:${subscriptionId}`)
                        if (randomSubscriptionId) {
                            const unsub = this._subs.get(randomSubscriptionId)
                            if (unsub) unsub()
                            this._subs.delete(randomSubscriptionId)

                            this._cache.delete(`${socket.connectionId}:${subscriptionId}`)
                        }
                    }
                    else if (parsed[0] === 'EVENT') {
                        const event = parsed[1] as unknown as Event

                        let publishConfrimed = false
                        const unsubPublish = this._pool.subscribe(
                            [{ ids: [event.id] }],
                            this._relays,
                            (event, isAfterEose, relayURL) => {
                                if (!publishConfrimed) {
                                    socket.send(JSON.stringify(["OK", event.id, true, ""]))
                                    publishConfrimed = true
                                    unsubPublish()
                                }
                            },
                            undefined,
                            undefined
                        )

                        this._pool.publish(event, this._relays)

                        const publishTimer = setTimeout(() => {
                            if (!publishConfrimed) {
                                socket.send(JSON.stringify(["NOTICE", "Event not published in time"]))
                                unsubPublish()
                            }
                            clearTimeout(publishTimer)
                        }, 2500)
                    }
                    else {
                        throw new Error(`Invalid event ${data.toString()}`)
                    }
                } catch (error) {
                    console.error('Unexpected error in Socket message: ', data.toString(), error)
                    for (const key of this._cache.keys()) {
                        if (key.startsWith(socket.connectionId)) {
                            const randomSubscriptionId = this._cache.get(key)
                            if (randomSubscriptionId) {
                                const unsub = this._subs.get(randomSubscriptionId)
                                if (unsub) unsub()
                                this._subs.delete(randomSubscriptionId)
                            }
                            this._cache.delete(key)
                        }
                    }
                    socket.close(3000, error.message)
                }
            })

            socket.on('close', async () => {
                for (const key of this._cache.keys()) {
                    if (key.startsWith(socket.connectionId)) {
                        const randomSubscriptionId = this._cache.get(key)
                        if (randomSubscriptionId) {
                            const unsub = this._subs.get(randomSubscriptionId)
                            if (unsub) unsub()
                            this._subs.delete(randomSubscriptionId)
                        }
                        this._cache.delete(key)
                    }
                }
            })
        })
    }

    public async getRelays(): Promise<{ url: string, connected: boolean }[]> {
        let relays: { url: string, connected: boolean }[] = []
        for (const [url, status] of this._pool.getRelayStatuses()) {
            relays = [...relays, { url: url, connected: status === 1 ? true : false }]
        }
        return relays
    }

    public async getStats() {
        const relays = await this.getRelays()
        return {
            connectedClients: WebSocketInstance.ws.clients.size,
            internalInfos: {
                subs: this._subs.size,
                cache: this._cache.size,
            },
            relays: {
                connected: relays.filter(relay => relay.connected).length,
                total: relays.length
            }
        }
    }

}

export default new WebSocketServer()