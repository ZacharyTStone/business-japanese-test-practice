/**
 * `node bjt/main.ts <command> …`, as `python -m bjt`, `python -m bjt.cli` and
 * the `bjt` script were.
 *
 * The one place the process's exit status is set: the command's own, from
 * `main()`. An interrupt (Ctrl-C) is Python's `KeyboardInterrupt`, which the
 * command line answered with "interrupted." and 130.
 */
import { main } from "./cli/index.ts";
import { print } from "./py.ts";

process.on("SIGINT", () => {
  print("\ninterrupted.");
  process.exit(130);
});

process.exitCode = await main({ argv: process.argv.slice(2) });
