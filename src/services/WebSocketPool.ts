import EventEmitter from "events";
import WebSocket from "ws";
import { getRelays } from "./env";
import Keyv from "keyv";
import crypto from "crypto";
import clone from "lodash/clone";
import NostrEvent, { EventType } from "./Event";

class WebSocketPool extends EventEmitter {
    private proxyEventIdSeparator = "-proxy-";

    servers: { url: string; attempts: number; timeout: NodeJS.Timeout | null; }[];
    maxAttempts: number;
    resetTimeout: number;
    sockets: { [url: string]: WebSocket };
    cache: Keyv;

    constructor(servers: string[], maxAttempts = 5, resetTimeout = 600_000) {
        super();
        this.servers = servers.map(url => ({ url, attempts: 0, timeout: null }));
        this.maxAttempts = maxAttempts;
        this.resetTimeout = resetTimeout;
        this.sockets = {};
        this.cache = new Keyv();

        this.connectAll();
    }

    private connectAll() {
        for (const server of this.servers) {
            this.connect(server.url);
        }
    }

    private connect(url: string) {
        const server = this.servers.find(s => s.url === url);
        if (!server) {
            throw new Error(`Server not found: ${url}`);
        }

        if (server.attempts >= this.maxAttempts) {
            console.log(`Max attempts reached for server: ${url}. Waiting ${this.resetTimeout / 1000}s before trying again.`);
            clearTimeout(server.timeout!);
            server.attempts = 0;
            server.timeout = setTimeout(() => {
                this.connect(url);
            }, this.resetTimeout);
            return;
        }

        const socket = new WebSocket(url);
        this.sockets[url] = socket;

        socket.on("open", () => {
            console.log(`Connected to server: ${url}`);
            server.attempts = 0;
            clearTimeout(server.timeout!);
            this.emit("open");
        });

        socket.on("message", async (data: Buffer) => {
            const message = Buffer.from(data).toString();
            const messageHash = crypto.createHash('sha256').update(message).digest('hex');

            if (await this.cache.get(messageHash)) {
                return;
            }
            await this.cache.set(messageHash, message, 6000);
            const clientId = await this.getRequestIdFromEvent(message);
            this.emit(`message:${clientId}`, await this.restoreInitialSubscriptionId(message));
        });

        socket.on("close", () => {
            console.log(`Disconnected from server: ${url}`);
            server.attempts++;
            delete this.sockets[url];
            this.connect(url);
            this.emit("close");
        });

        socket.on("error", (error: any) => {
            console.error(`Error with server ${url}: ${error} `);
            delete this.sockets[url];
        });
    }

    public async broadcast(data: string, exclude: WebSocket, clientId: string) {
        for (const socket of Object.values(this.sockets)) {
            if (socket !== exclude) {
                const message = await this.prepareMessageForClient(data, clientId);
                if (!message) return;
                socket.send(Buffer.from(message));
            }
        }
    }

    ///
    /// We need to change Subscription ID to be unique per client
    /// [..., SubscriptionID, ...] => [..., SubscriptionID-proxy-clientId, ...]
    /// SubscriptionID is always in the 2nd position
    ///

    private async getRequestIdFromEvent(event: string) {
        const eventJson = JSON.parse(event);
        if (eventJson.length === 0) {
            return null;
        }

        if (eventJson[0] === EventType.Request ||
            eventJson[0] === EventType.Close ||
            eventJson[0] === EventType.Eose ||
            eventJson[0] === EventType.Event
        ) {
            const parts = eventJson[1].split(this.proxyEventIdSeparator);
            return parts[parts.length - 1];
        }
        else if (eventJson[0] === EventType.Ok) {
            const clientId = await this.cache.get(eventJson[1])
            if (!clientId) {
                throw new Error(`ClientId not found for proxy event id: ${event}`);
            }
            return clientId;
        }
        else {
            console.error(`No request id found for event: ${event}`)
            return null;
        }

    }

    private async getInitialSubscriptionIdFromCache(event: string): Promise<{ cacheKey: string, subId: string } | null> {
        const eventJson = JSON.parse(event);
        if (eventJson.length === 0) {
            return null;
        }
        const proxySubId = eventJson[1]

        const initialSubId = await this.cache.get(proxySubId)
        if (!initialSubId) {
            throw new Error(`Initial subscription id not found for proxy subscription id: ${proxySubId}`);
        }
        return { cacheKey: proxySubId, subId: initialSubId }
    }

    private async restoreInitialSubscriptionId(event: string) {
        const eventJson = JSON.parse(event);
        if (eventJson.length === 0) {
            throw new Error("Invalid event");
        }

        if (eventJson[0] === EventType.Request ||
            eventJson[0] === EventType.Close ||
            eventJson[0] === EventType.Eose ||
            eventJson[0] === EventType.Event) {
            const cachedResult = await this.getInitialSubscriptionIdFromCache(event);

            // If we can't find the initial subscription id, we just return the event as is
            if (!cachedResult) return event;

            eventJson[1] = cachedResult.subId;
            return JSON.stringify(eventJson);
        }
        else {
            return event;
        }
    }

    private async prepareMessageForClient(message: string, clientId: string) {
        const messageJson = JSON.parse(message);
        if (messageJson.length === 0) {
            return null;
        }

        const eventType = NostrEvent.getEventType(messageJson[0]);

        // Changing subscription id only for request and close events
        // it's used to identify the client that sent the request
        if (eventType === EventType.Request || eventType === EventType.Close) {
            const postSubId = `${this.proxyEventIdSeparator}${clientId}`;
            let oldSubId = clone(messageJson[1]);
            let newSubId = clone(messageJson[1]);

            // truncate intial subscription id because some relay servers don't like it
            // https://github.com/hoytech/strfry/blob/HEAD/src/Subscription.h#L11
            if (oldSubId.length > 63 || oldSubId.length + postSubId.length > 63) {
                // truncate to 63 characters
                newSubId = oldSubId.slice(0, 63);
                // remove enough characters to put the postSubId at the end
                newSubId = newSubId.slice(0, newSubId.length - postSubId.length);
            }

            newSubId = `${newSubId}${postSubId}`;

            // Caching the subscription id so we can use it later to send it back to the client
            await this.cache.set(newSubId, oldSubId);

            messageJson[1] = newSubId;

            return JSON.stringify(messageJson);
        }
        // Events sent do not contains subscription id. We need to use event ID to identify the client
        else if (eventType === EventType.Event) {
            const eventId = messageJson[1].id;
            await this.cache.set(eventId, clientId);
        }
        return message
    }
    public getRelays() {
        return Object.keys(this.sockets);
    }
}

export default new WebSocketPool(getRelays());
