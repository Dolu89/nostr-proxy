import cron from "node-cron";
import NostrPool from "../app/Services/NostrPool";

cron.schedule('*/5 * * * *', async () => {
    if (!NostrPool.isInitialized) return
    await NostrPool.init()
});