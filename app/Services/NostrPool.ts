
import { Filter, Event, Relay, relayInit, Sub } from "nostr-tools"
import { normalizeURL } from "./NostrTools"
import EventEmitter from "node:events"
import Env from "@ioc:Adonis/Core/Env"

class NostrPool {
    public isInitialized: boolean
    private _relaysUrls: string[]
    private _connections: { [url: string]: Relay }

    constructor(relayUrls: string[]) {
        this.isInitialized = false
        this._relaysUrls = relayUrls
        this._connections = {}
    }

    private _verifyInitializedOrDie() {
        if (!this.isInitialized) throw new Error('NostrPool not initialized. Call init() first.')
    }

    public async init() {
        for (const relayUrl of this._relaysUrls) {
            await this._openRelayConnection(relayUrl)
        }
        this.isInitialized = true
    }

    private async _openRelayConnections(relays: string[]) {
        for (const relayUrl of relays) {
            await this._openRelayConnection(relayUrl).catch(console.error)
        }
    }

    private async _openRelayConnection(relayUrl: string) {
        const normalizedURL = normalizeURL(relayUrl)

        if (this._connections[normalizedURL]?.status === 1) return

        try {
            this._connections[normalizedURL] = relayInit(normalizedURL)
            await this._connections[normalizedURL].connect()

            this._connections[normalizedURL].on('connect', () => {
                console.log(`Connected to ${this._connections[normalizedURL].url}`)
            })
            this._connections[normalizedURL].on('error', () => {
                console.log(`Failed to connect to ${this._connections[normalizedURL].url}.`)
                throw new Error('Failed to connect to relay')
            })
        } catch (_) {
            console.error(`Error while initializing relay ${normalizedURL}.`)
        }
    }

    public async sub(relays: string[], filters: Filter[], subscriptionId: string): Promise<EventEmitter> {
        this._verifyInitializedOrDie()
        await this._openRelayConnections(relays)

        const normalizedURLs = relays.map(normalizeURL)
        const _knownIds = new Set<string>()
        const _subs = new Set<Sub>()
        let eoseCount = 0
        let eoseTimeout = false

        const emitter = new EventEmitter()

        emitter.on('unsubscribe', () => {
            emitter.removeAllListeners()
            _subs.forEach(sub => {
                sub.unsub()
            })
            _knownIds.clear()
            _subs.clear()
        })

        for (const normalizedURL of normalizedURLs) {
            let conn = this._connections[normalizedURL]
            if (conn?.status !== 1) continue

            const sub = conn.sub(filters, { id: subscriptionId })
            sub.on('event', (event: Event) => {
                if (_knownIds.has(event.id as string)) return
                _knownIds.add(event.id as string)
                emitter.emit('event', event)
            })
            sub.on('eose', () => {
                eoseCount++
                if (eoseCount === 1) {
                    const timer = setTimeout(() => {
                        emitter.emit('eose')
                        eoseTimeout = true
                        clearTimeout(timer)
                    }, 2500)
                }
                if (eoseCount === this._countConnectedRelays() && !eoseTimeout) {
                    emitter.emit('eose')
                }
            })
            _subs.add(sub)
        }

        return emitter
    }

    // There is no solution currently to unsubscribe from a publish. It creates a memory leak.
    // TODO : Find a solution to unsubscribe from a publish in nostr-tools
    public async publish(relays: string[], event: Event): Promise<EventEmitter> {
        this._verifyInitializedOrDie()
        await this._openRelayConnections(relays)

        const emitter = new EventEmitter()

        emitter.on('unsubscribe', () => {
            emitter.removeAllListeners()
        })

        let seenOn = 0
        let seenOnTimeout = false

        for (const relay of relays) {
            let conn = this._connections[normalizeURL(relay)]
            if (conn?.status !== 1) continue

            let pub = conn.publish(event)
            pub.on('ok', () => {
                seenOn++
                if (seenOn === 1) {
                    const timer = setTimeout(() => {
                        emitter?.emit('ok')
                        seenOnTimeout = true
                        emitter?.emit('unsubscribe')
                        clearTimeout(timer)
                    }, 2500)
                }
                if (seenOn === this._countConnectedRelays() && !seenOnTimeout) {
                    emitter?.emit('ok')
                    emitter?.emit('unsubscribe')
                }
            })
            pub.on('failed', (reason: string) => {
                emitter?.emit('failed', reason)
                const timer = setTimeout(() => {
                    emitter?.emit('unsubscribe')
                    clearTimeout(timer)
                }, 2500)
            })
        }

        return emitter
    }


    private _countConnectedRelays(): number {
        this._verifyInitializedOrDie()
        return Object.values(this._connections).filter(conn => conn.status === 1).length
    }
}

export default new NostrPool([...Env.get('RELAYS').split(',')])