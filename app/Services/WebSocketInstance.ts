import ws from 'ws'
import Server from '@ioc:Adonis/Core/Server'
import WebSocketHandler from './WebSocketHandler'

class Ws {
    public ws: ws.Server
    private booted = false
    public emit: Event

    public async boot() {
        /**
         * Ignore multiple calls to the boot method
         */
        if (this.booted) {
            return
        }

        this.booted = true
        this.ws = new ws.Server({ server: Server.instance! })
        await WebSocketHandler.boot()
    }
}

export default new Ws()