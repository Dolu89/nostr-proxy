import clone from "lodash/clone";

export enum EventType {
    Event = "EVENT",
    Close = "CLOSE",
    Request = "REQ",
    Eose = "EOSE",
    Notice = "NOTICE",
    Ok = "OK",
}

export enum EventSource {
    Client = "CLIENT",
    Relay = "RELAY",
}

const proxyEventIdSeparator = "-proxy-";

export class Event {
    public type: EventType;
    public subscriptionId: string;
    public proxySubscriptionId: string;

    private nostrEvent: string;
    public clientId: string;
    public source: EventSource;

    constructor(type: EventType, subscriptionId: string, nostrEvent: string, clientId?: string) {
        this.type = type;
        this.subscriptionId = subscriptionId;
        this.proxySubscriptionId = subscriptionId;
        this.nostrEvent = nostrEvent;

        // If clientId is provided, it means it's a CLIENT to RELAY event, clientId is the unique id of the query
        if (clientId) {
            this.source = EventSource.Client;

            // suffixSubId should be like this -proxy-req-X
            const suffixSubId = `${proxyEventIdSeparator}${clientId}`;
            const oldSubId = clone(subscriptionId);
            let newSubId = clone(subscriptionId);
            // truncate intial subscription id because some relay servers don't like it
            // https://github.com/hoytech/strfry/blob/HEAD/src/Subscription.h#L11
            if (oldSubId.length > 63 || oldSubId.length + suffixSubId.length > 63) {
                // truncate to 63 characters
                newSubId = oldSubId.slice(0, 63);
                // remove enough characters to put the suffixSubId at the end
                newSubId = newSubId.slice(0, newSubId.length - suffixSubId.length);
            }
            newSubId = `${newSubId}${suffixSubId}`;

            this.clientId = clientId;
            this.proxySubscriptionId = newSubId;

            // Reset proxySubscriptionId for PUSH Event
            if (this.type === EventType.Event) {
                this.proxySubscriptionId = subscriptionId;
            }
        }
        // If not provided, it means it's a RELAY to CLIENT event, clientId is in the nostrEvent, Except for Created Event (type === EventType.Ok)
        else {
            this.source = EventSource.Relay;

            this.clientId = "";
            if (this.type !== EventType.Ok && this.type !== EventType.Notice) {
                const parts = this.subscriptionId.split(proxyEventIdSeparator);
                this.clientId = parts[parts.length - 1];
            }

        }
    }

    public getNostrEventForClient(subscriptionId: string): string {
        return this.nostrEvent.replace(this.proxySubscriptionId, subscriptionId);
    }
    public getNostrEventForRelay(): string {
        if (this.type === EventType.Request || this.type === EventType.Close) {
            const eventJson = JSON.parse(this.nostrEvent);
            eventJson[1] = this.proxySubscriptionId;
            return JSON.stringify(eventJson);
        }
        return this.nostrEvent;
    }

}

function isValidEventType(eventType: string) {
    return Object.values(EventType).includes(eventType as EventType);
}

export function getEventType(event: string): EventType {
    if (!isValidEventType(event)) {
        throw new Error(`Invalid event type for event: ${event}`);
    }

    return event as EventType;
}

export function parseEvent(message: string, clientId?: string): Event {
    const messageJson = JSON.parse(message);
    if (messageJson.length === 0) {
        throw new Error(`Invalid event: ${message}`, { cause: "A problem occured while JSON.parse(event)" });
    }

    const eventType = getEventType(messageJson[0]);
    let subscriptionId = null;

    if (eventType === EventType.Event) {
        // Length of 2 means that the event is a PUSH event from CLIENT to RELAYS
        if (messageJson.length === 2) {
            subscriptionId = messageJson[1].id;
        }
        // Length of 3 means that the event is a GET event from RELAYS to CLIENT
        else if (messageJson.length === 3) {
            subscriptionId = messageJson[1];
        }
        else {
            throw new Error(`Invalid event: ${message}`, { cause: "Invalid event length" });
        }
    }
    else if (eventType === EventType.Request) {
        if (messageJson.length !== 3) {
            throw new Error(`Invalid event: ${message}`, { cause: "Invalid event length" });
        }
        subscriptionId = messageJson[1];
    }
    else if (eventType === EventType.Ok || eventType === EventType.Eose || eventType === EventType.Close) {
        if (messageJson.length < 2) {
            throw new Error(`Invalid event: ${message}`, { cause: "Invalid event length" });
        }
        subscriptionId = messageJson[1];
    }
    else if (eventType === EventType.Notice) {
        // TODO
    }
    else {
        throw new Error(`Invalid event: ${message}`, { cause: "Can't determine event type" });
    }

    return new Event(eventType, subscriptionId, message, clientId);
}

