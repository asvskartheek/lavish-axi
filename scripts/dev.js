// Keep development reviews separate from the installed CLI and its live sessions.
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
process.env.LAVISH_AXI_STATE_DIR ||= path.join(root, ".lavish-dev");
process.env.LAVISH_AXI_PORT ||= "4388";
process.env.LAVISH_AXI_HOST ||= "127.0.0.1";
process.env.LAVISH_AXI_LINK_HOST ||= "127.0.0.1";
process.env.LAVISH_AXI_TELEMETRY ||= "0";

const { run } = await import("../src/cli.js");
await run(process.argv.slice(2));
