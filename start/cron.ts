import cron from "node-cron";
import WebSocketHandler from "../app/Services/WebSocketHandler";

cron.schedule('*/5 * * * *', async () => {
    if (!WebSocketHandler.booted) return
    await WebSocketHandler.initRelays()
});