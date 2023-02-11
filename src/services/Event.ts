export enum EventType {
    Event = "EVENT",
    Close = "CLOSE",
    Request = "REQ",
    Eose = "EOSE",
    Notice = "NOTICE",
    Ok = "OK",
}

export default class NostrEvent {
    public static getEventType(event: string): EventType {
        if (!this.isValidEventType(event)) {
            throw new Error(`Invalid event type for event: ${event}`);
        }

        return event as EventType;
    }

    private static isValidEventType(eventType: string) {
        return Object.values(EventType).includes(eventType as EventType);
    }
}