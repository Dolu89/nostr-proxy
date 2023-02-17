// import { Pub, Relay, relayInit, SubscriptionOptions, Filter, Event, Sub } from "nostr-tools"
// import Redis from "@ioc:Adonis/Addons/Redis"
import { Filter, Relay, relayInit, Sub, SubscriptionOptions, Event, Pub } from "@dolu/nostr-tools"
// import { Pub, Relay, relayInit, Sub, SubscriptionOptions } from "../Models/Relay"
// import { Event } from "../Models/Event"
import { normalizeURL } from "./NostrTools"

export class SimplePool {
  private _conn: { [url: string]: Relay }

  constructor() {
    this._conn = {}
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
    let knownIds = new Set<string>()

    let modifiedOpts = opts || {}
    modifiedOpts.alreadyHaveEvent = async (id, _) => {
      return knownIds.has(id)
    }
    modifiedOpts.skipVerification = true

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
      s.on('event', async (event: Event) => {
        if (!knownIds.has(event.id as string)) {
          knownIds.add(event.id as string)
          for (let cb of eventListeners.values()) cb(event)
        }
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
      async unsub() {
        subs.forEach(sub => sub.unsub())
        eventListeners.clear()
        eoseListeners.clear()
        knownIds.clear()
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

}

function badPub(relay: string): Pub {
  return {
    on(typ, cb) {
      if (typ === 'failed') cb(`relay ${relay} not connected`)
    },
    off() { },
    unpub() { },
  }
}
