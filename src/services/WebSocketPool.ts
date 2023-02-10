import EventEmitter from "events";
import WebSocket from "ws";
import { getRelays } from "./env";

class WebSocketPool extends EventEmitter {
    servers: { url: string; attempts: number; timeout: NodeJS.Timeout | null; }[];
    maxAttempts: number;
    resetTimeout: number;
    sockets: { [url: string]: WebSocket };

    constructor(servers: string[], maxAttempts = 5, resetTimeout = 600_000) {
        super();
        this.servers = servers.map(url => ({ url, attempts: 0, timeout: null }));
        this.maxAttempts = maxAttempts;
        this.resetTimeout = resetTimeout;
        this.sockets = {};

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

        socket.on("message", (data: Buffer) => {
            const message = Buffer.from(data).toString();
            this.emit("message", message);
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

    public broadcast(data: string, exclude: WebSocket) {
        for (const socket of Object.values(this.sockets)) {
            if (socket !== exclude) {
                socket.send(Buffer.from(data));
            }
        }
    }

    public getRelays() {
        return Object.keys(this.sockets);
    }
}

export default new WebSocketPool(getRelays());
