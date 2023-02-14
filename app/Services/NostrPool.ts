// Customized SimplePool.ts from https://github.com/nbd-wtf/nostr-tools

import Env from "@ioc:Adonis/Core/Env"
import Keyv from "keyv"
import { Filter, Event } from "nostr-tools"
import { Pub, Relay, relayInit, Sub, SubscriptionOptions } from "../Models/Relay"
import { normalizeURL } from "./NostrTools"
import { v4 as uuidv4 } from "uuid";

export class NostrPool {
    private _conn: { [url: string]: Relay }
    private _seenOn: { [id: string]: Set<string> } | Keyv // a map of all events we've seen in each relay

    constructor() {
        const useRedis = Env.get("REDIS_CONNECTION")
        if (useRedis) {
            this._seenOn = new Keyv(useRedis, { namespace: "nostr-seen-on" });
        }
        else {
            this._seenOn = {}
        }
        this._conn = {}
    }

    private async _getSeenOn(id: string): Promise<Set<string>> {
        if (this._seenOn instanceof Keyv) {
            return new Set(await this._seenOn.get(id) || [])
        }
        return this._seenOn[id] || new Set()
    }

    private async _setSeenOn(id: string, set: Set<string>) {
        if (this._seenOn instanceof Keyv) {
            // 5 minutes of cache
            await this._seenOn.set(id, [...set], 5 * 1000 * 60)
        }
        else {
            this._seenOn[id] = set
        }
    }

    async close(relays: string[]): Promise<void> {
        await Promise.all(
            relays.map(async url => {
                let relay = this._conn[normalizeURL(url)]
                if (relay) await relay.close()
            })
        )
    }

    async ensureRelay(url: string): Promise<Relay> {
        const nm = normalizeURL(url)
        const existing = this._conn[nm]
        if (existing) return existing

        const relay = relayInit(nm)
        this._conn[nm] = relay

        await relay.connect()

        return relay
    }

    sub(relays: string[], filters: Filter[], opts?: SubscriptionOptions): Sub {
        let _knownIds: Set<string> | Keyv;
        const knowIdsId = uuidv4()
        if (Env.get("REDIS_CONNECTION")) {
            _knownIds = new Keyv(Env.get("REDIS_CONNECTION"), { namespace: knowIdsId });
        }
        else {
            _knownIds = new Set()
        }

        const addKnownIds = async (id: string) => {
            if (_knownIds instanceof Keyv) {
                let currentIds = await _knownIds.get(knowIdsId)
                if (!currentIds) currentIds = []
                return await _knownIds.set(knowIdsId, [...currentIds, id], 5 * 1000 * 60)
            }
            return _knownIds.add(id)
        }
        const hasKnownIds = async (id: string) => {
            if (_knownIds instanceof Keyv) {
                return await _knownIds.has(knowIdsId)
            }
            return _knownIds.has(id)
        }

        let modifiedOpts = opts || {}
        modifiedOpts.alreadyHaveEvent = async (id, url) => {
            const set = await this._getSeenOn(id)
            set.add(url)
            await this._setSeenOn(id, set)
            return await hasKnownIds(id)
        }

        let subs: Sub[] = []
        let eventListeners: Set<(event: Event) => void> = new Set()
        let eoseListeners: Set<() => void> = new Set()
        let eosesMissing = relays.length

        let eoseSent = false
        let eoseTimeout = setTimeout(() => {
            eoseSent = true
            for (let cb of eoseListeners.values()) cb()
        }, 2400)

        relays.forEach(async relay => {
            let r = await this.ensureRelay(relay)
            if (!r) return
            let s = r.sub(filters, modifiedOpts)
            s.on('event', (event: Event) => {
                addKnownIds(event.id as string)
                for (let cb of eventListeners.values()) cb(event)
            })
            s.on('eose', () => {
                if (eoseSent) return

                eosesMissing--
                if (eosesMissing === 0) {
                    clearTimeout(eoseTimeout)
                    for (let cb of eoseListeners.values()) cb()
                }
            })
            subs.push(s)
        })

        let greaterSub: Sub = {
            sub(filters, opts) {
                subs.forEach(sub => sub.sub(filters, opts))
                return greaterSub
            },
            unsub() {
                if (_knownIds instanceof Keyv) {
                    _knownIds.clear()
                }
                subs.forEach(sub => sub.unsub())
            },
            on(type, cb) {
                switch (type) {
                    case 'event':
                        eventListeners.add(cb)
                        break
                    case 'eose':
                        eoseListeners.add(cb)
                        break
                }
            },
            off(type, cb) {
                if (type === 'event') {
                    eventListeners.delete(cb)
                } else if (type === 'eose') eoseListeners.delete(cb)
            }
        }

        return greaterSub
    }

    get(
        relays: string[],
        filter: Filter,
        opts?: SubscriptionOptions
    ): Promise<Event | null> {
        return new Promise(resolve => {
            let sub = this.sub(relays, [filter], opts)
            let timeout = setTimeout(() => {
                sub.unsub()
                resolve(null)
            }, 1500)
            sub.on('event', (event: Event) => {
                resolve(event)
                clearTimeout(timeout)
                sub.unsub()
            })
        })
    }

    list(
        relays: string[],
        filters: Filter[],
        opts?: SubscriptionOptions
    ): Promise<Event[]> {
        return new Promise(resolve => {
            let events: Event[] = []
            let sub = this.sub(relays, filters, opts)

            sub.on('event', (event: Event) => {
                events.push(event)
            })

            // we can rely on an eose being emitted here because pool.sub() will fake one
            sub.on('eose', () => {
                sub.unsub()
                resolve(events)
            })
        })
    }

    publish(relays: string[], event: Event): Pub[] {
        return relays.map(relay => {
            let r = this._conn[normalizeURL(relay)]
            if (!r) return badPub(relay)
            let s = r.publish(event)
            return s
        })
    }

    async seenOn(id: string): Promise<string[]> {
        const seen = await this._getSeenOn(id)
        return Array.from(seen?.values?.() || [])
    }
}

function badPub(relay: string): Pub {
    return {
        on(typ, cb) {
            if (typ === 'failed') cb(`relay ${relay} not connected`)
        },
        off() { }
    }
}
