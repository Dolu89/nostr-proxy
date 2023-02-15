import "websocket-polyfill"
import { v4 as uuidv4 } from "uuid";
import Env from "@ioc:Adonis/Core/Env"
import { WebSocket } from "ws";
import NostrPool from "./NostrPool";
import { Filter, Event } from "nostr-tools";
import WebSocketInstance from "./WebSocketInstance"
import { EventEmitter } from "node:events";

interface CustomWebsocket extends WebSocket {
    connectionId: string
}

class WebSocketServer {

    public booted: boolean

    private _relays: string[]
    private _pool: typeof NostrPool
    private _cache: Map<string, string>
    private _subs: Map<string, EventEmitter>

    constructor() {
        this.booted = false
        this._relays = [...Env.get('RELAYS').split(',')]
        this._pool = NostrPool

        this._cache = new Map()
        this._subs = new Map()
    }

    public async boot() {
        if (this.booted) return

        await this._pool.init()
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
                            this._subs.get(oldRandomSubscriptionId)?.emit('unsubscribe')
                            this._subs.delete(oldRandomSubscriptionId)
                        }

                        this._cache.set(`${socket.connectionId}:${subscriptionId}`, randomSubscriptionId)

                        this._subs.set(randomSubscriptionId, await this._pool.sub(
                            this._relays,
                            [filters],
                            randomSubscriptionId
                        ))

                        this._subs.get(randomSubscriptionId)?.on('event', (data: Event) => {
                            socket.send(JSON.stringify(["EVENT", subscriptionId, data]))
                        })
                        this._subs.get(randomSubscriptionId)?.on('eose', () => {
                            socket.send(JSON.stringify(["EOSE", subscriptionId]))
                        })
                    }
                    else if (parsed[0] === 'CLOSE') {
                        const subscriptionId = parsed[1]

                        const randomSubscriptionId = this._cache.get(`${socket.connectionId}:${subscriptionId}`)
                        if (randomSubscriptionId) {
                            this._subs.get(randomSubscriptionId)?.emit('unsubscribe')
                            this._subs.delete(randomSubscriptionId)

                            this._cache.delete(`${socket.connectionId}:${subscriptionId}`)
                        }
                    }
                    else if (parsed[0] === 'EVENT') {
                        // const event = parsed[1] as unknown as Event
                        // const pub = await this._pool.publish(this._relays, event)
                        // pub.on('ok', () => {
                        //     socket.send(JSON.stringify(["OK", event.id, true, ""]))
                        // })
                        // pub.on('failed', (reason: string) => {
                        //     socket.send(JSON.stringify(["NOTICE", reason]))
                        // })
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
                                this._subs.get(randomSubscriptionId)?.emit('unsubscribe')
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
                            this._subs.get(randomSubscriptionId)?.emit('unsubscribe')
                            this._subs.delete(randomSubscriptionId)
                        }
                        this._cache.delete(key)
                    }
                }
            })
        })
    }

    public getStats() {
        const relays = NostrPool.getRelaysStatus()
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