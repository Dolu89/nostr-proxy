
import Env from "@ioc:Adonis/Core/Env"
import Keyv from "keyv"
import { Filter, Event, Relay, relayInit, Sub } from "nostr-tools"
import { normalizeURL } from "./NostrTools"
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws"
import EventEmitter from "node:events"

export class NostrPool {
    private isInitialized: boolean
    private _relaysUrls: string[]
    private _connections: { [url: string]: Relay }
    // private _subListners: { [subscriptionId: string]: EventEmitter }


    constructor(relayUrls: string[]) {
        this.isInitialized = false
        this._relaysUrls = relayUrls
        this._connections = {}
        // this._subListners = {}
    }

    private _verifyInitializedOrDie() {
        if (!this.isInitialized) throw new Error('NostrPool not initialized. Call init() first.')
    }

    public async init() {
        await this._openRelayConnections(this._relaysUrls).catch(console.error)
        this.isInitialized = true
    }

    private async _openRelayConnections(relays: string[]) {
        for (const relayUrl of relays) {
            const normalizedURL = normalizeURL(relayUrl)

            if (this._connections[normalizedURL]) continue

            try {
                this._connections[normalizedURL] = relayInit(normalizedURL)
                await this._connections[normalizedURL].connect()

                this._connections[normalizedURL].on('connect', () => {
                    console.log(`connected to ${this._connections[normalizedURL].url}`)
                })
                this._connections[normalizedURL].on('error', () => {
                    console.log(`failed to connect to ${this._connections[normalizedURL].url}`)
                })
            } catch (error) {
                console.error(`Error while initializing relay ${normalizedURL}`)
                console.error(error)
            }
        }
    }

    // private _isExistingConnection(relayUrl: string) {
    //     const normalizedURL = normalizeURL(relayUrl)
    //     return this._connections[normalizedURL] !== undefined
    // }

    // private _initRelayConnection(relayUrl: string) {
    //     const normalizedURL = normalizeURL(relayUrl)
    //     if (this._connections[normalizedURL]) return this._connections[normalizedURL]
    //     this._connections[normalizedURL] = new WebSocket(normalizedURL)
    //     return this._connections[normalizedURL]
    // }

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

        for (const relayUrl of normalizedURLs) {
            const sub = this._connections[relayUrl].sub(filters, { id: subscriptionId })
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
                if (eoseCount === normalizedURLs.length && !eoseTimeout) {
                    emitter.emit('eose')
                }
            })
            _subs.add(sub)
        }

        return emitter



        // let eventListeners: Set<(event: Event) => void> = new Set()
        // let eoseListeners: Set<() => void> = new Set()
        // let eosesMissing = relays.length

        // let eoseSent = false
        // let eoseTimeout = setTimeout(() => {
        //     eoseSent = true
        //     for (let cb of eoseListeners.values()) cb()
        // }, 2400)

        // relays.forEach(async relay => {
        // let r = await this.ensureRelay(relay)
        // if (!r) return
        // let s = r.sub(filters, modifiedOpts)
        // s.on('event', async (event: Event) => {
        //     await addKnownIds(event.id as string)
        //     for (let cb of eventListeners.values()) cb(event)
        // })
        // s.on('eose', () => {
        //     if (eoseSent) return

        //     eosesMissing--
        //     if (eosesMissing === 0) {
        //         clearTimeout(eoseTimeout)
        //         for (let cb of eoseListeners.values()) cb()
        //     }
        // })
        // subs.push(s)
        // })

        // let greaterSub: Sub = {
        //     sub(filters, opts) {
        //         subs.forEach(sub => sub.sub(filters, opts))
        //         return greaterSub
        //     },
        //     unsub() {
        //         if (_knownIds instanceof Keyv) {
        //             _knownIds.clear().catch(console.error)
        //         }
        //         subs.forEach(sub => sub.unsub())
        //     },
        //     on(type, cb) {
        //         switch (type) {
        //             case 'event':
        //                 eventListeners.add(cb)
        //                 break
        //             case 'eose':
        //                 eoseListeners.add(cb)
        //                 break
        //         }
        //     },
        //     off(type, cb) {
        //         if (type === 'event') {
        //             eventListeners.delete(cb)
        //         } else if (type === 'eose') eoseListeners.delete(cb)
        //     }
        // }

        // return greaterSub
    }



    public publish() {

    }

}