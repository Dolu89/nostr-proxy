import cron from "node-cron";
import NostrSocket from "../app/Services/NostrSocket";

cron.schedule('*/1 * * * *', async () => {
    if (!NostrSocket.booted) return
    await NostrSocket.initRelays()
});