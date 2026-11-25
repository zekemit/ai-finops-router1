import { runCli } from "./cli";
import { createNodeIO } from "./node-io";

process.exitCode = await runCli(process.argv.slice(2), createNodeIO());
