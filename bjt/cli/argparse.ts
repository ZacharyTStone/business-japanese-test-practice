/**
 * The part of Python's argparse the `bjt` commands use, with its rules.
 *
 * Each command module registers its subcommands the way it did with
 * argparse — `sub.addParser(name, {help})`, then `p.addArgument("--per-slot",
 * {type: "int", default: 2})` — so a command's flags, their defaults and their
 * spellings read the same as before, and the parsed result is the same
 * namespace: the dest of `--per-slot` is `per_slot`, a flag not given holds
 * its default (null when it has none), a `store_true` flag is false.
 *
 * Supported: positionals (nargs "?" and "*"), long and short options,
 * `store`, `store_true`, `BooleanOptional` (`--x` / `--no-x`), `type`
 * ("int", "float", or a function), `choices`, `required`, `default`,
 * `nargs: "*"` on an option, `--opt=value`, unambiguous prefixes of long
 * options (argparse's allow_abbrev), `--help`, and `setDefaults`. A usage
 * error prints to stderr and raises `SystemExit(2)`, as argparse exits 2.
 */
import { SystemExit, ewrite, write } from "../py.ts";

export type Namespace = Record<string, any>;

type ArgType = "int" | "float" | "str" | ((value: string) => unknown);

export type ArgumentOptions = {
  action?: "store" | "store_true" | "store_false" | "BooleanOptional";
  type?: ArgType;
  default?: unknown;
  choices?: readonly unknown[];
  required?: boolean;
  help?: string;
  metavar?: string;
  dest?: string;
  nargs?: "?" | "*";
};

type Argument = ArgumentOptions & {
  flags: string[];
  positional: boolean;
  dest: string;
};

export type ParserOptions = {
  prog?: string;
  description?: string;
  epilog?: string;
  help?: string;
};

export class ArgumentParser {
  readonly prog: string;
  readonly description: string;
  readonly epilog: string;
  private args: Argument[] = [];
  private defaults: Namespace = {};
  private sub: SubParsers | null = null;

  constructor(opts: ParserOptions = {}) {
    this.prog = opts.prog ?? "bjt";
    this.description = opts.description ?? "";
    this.epilog = opts.epilog ?? "";
  }

  addArgument(...spec: [...string[], ArgumentOptions] | string[]): void {
    const last = spec[spec.length - 1];
    const opts: ArgumentOptions = typeof last === "string" ? {} : last;
    const flags = (typeof last === "string" ? spec : spec.slice(0, -1)) as string[];
    const positional = !flags[0].startsWith("-");
    const longest = flags.find((f) => f.startsWith("--")) ?? flags[0];
    const dest = opts.dest ?? longest.replace(/^-+/, "").replace(/-/g, "_");
    this.args.push({ ...opts, flags, positional, dest });
  }

  addSubparsers(opts: { dest: string; required?: boolean }): SubParsers {
    this.sub = new SubParsers(this.prog, opts.dest, opts.required ?? false);
    return this.sub;
  }

  setDefaults(values: Namespace): void {
    Object.assign(this.defaults, values);
  }

  /** argparse's `parser.error(message)`: usage and the message on stderr,
   *  exit status 2. */
  error(message: string): never {
    ewrite(this.usage() + "\n");
    ewrite(`${this.prog}: error: ${message}\n`);
    throw new SystemExit(2, message);
  }

  usage(): string {
    const parts = [`usage: ${this.prog}`];
    for (const a of this.args) {
      const name = a.metavar ?? (a.positional ? a.dest : a.dest.toUpperCase());
      if (a.positional) parts.push(a.nargs === "?" ? `[${name}]` : a.nargs === "*" ? `[${name} ...]` : name);
      else {
        const flag = a.flags[a.flags.length - 1];
        const takes = a.action === "store_true" || a.action === "store_false" || a.action === "BooleanOptional" ? "" : ` ${name}`;
        parts.push(a.required ? `${flag}${takes}` : `[${flag}${takes}]`);
      }
    }
    if (this.sub) parts.push(`{${this.sub.names().join(",")}} ...`);
    return parts.join(" ");
  }

  help(): string {
    const lines = [this.usage(), ""];
    if (this.description) lines.push(this.description, "");
    if (this.sub) {
      lines.push("commands:");
      for (const [name, p] of this.sub.entries()) lines.push(`  ${name.padEnd(14)} ${p.helpText}`);
      lines.push("");
    }
    const pos = this.args.filter((a) => a.positional);
    if (pos.length) {
      lines.push("positional arguments:");
      for (const a of pos) lines.push(`  ${(a.metavar ?? a.dest).padEnd(22)} ${a.help ?? ""}`.trimEnd());
      lines.push("");
    }
    lines.push("options:", `  ${"-h, --help".padEnd(22)} show this help message and exit`);
    for (const a of this.args.filter((x) => !x.positional)) {
      const flags = a.action === "BooleanOptional"
        ? `${a.flags.join(", ")}, --no-${a.flags[0].replace(/^--/, "")}`
        : a.flags.join(", ");
      const choices = a.choices ? ` {${a.choices.join(",")}}` : "";
      lines.push(`  ${(flags + choices).padEnd(22)} ${a.help ?? ""}`.trimEnd());
    }
    if (this.epilog) lines.push("", this.epilog);
    return lines.join("\n") + "\n";
  }

  parseArgs(argv: readonly string[]): Namespace {
    const ns: Namespace = {};
    for (const a of this.args) {
      if (a.action === "store_true") ns[a.dest] = a.default ?? false;
      else if (a.action === "store_false") ns[a.dest] = a.default ?? true;
      else if (a.positional && a.nargs === "*") ns[a.dest] = a.default ?? [];
      else ns[a.dest] = a.default ?? null;
    }
    Object.assign(ns, this.defaults);

    const positionals = this.args.filter((a) => a.positional);
    const seen = new Set<Argument>();
    const loose: string[] = [];
    let i = 0;
    while (i < argv.length) {
      const token = argv[i];
      if (token === "-h" || token === "--help") {
        write(this.help());
        throw new SystemExit(0);
      }
      if (token === "--") {
        loose.push(...argv.slice(i + 1));
        break;
      }
      if (this.sub && !token.startsWith("-") && loose.length >= this.positionalCount(positionals)) {
        // Everything after the command name belongs to the command.
        const child = this.sub.get(token);
        if (!child) {
          this.error(`argument ${this.sub.dest}: invalid choice: '${token}' (choose from ${this.sub.names().map((n) => `'${n}'`).join(", ")})`);
        }
        this.assignPositionals(ns, positionals, loose);
        ns[this.sub.dest] = token;
        Object.assign(ns, child.parseArgs(argv.slice(i + 1)));
        ns[this.sub.dest] = token;
        return this.finish(ns, seen, true);
      }
      if (token.startsWith("-") && token !== "-" && !/^-\d/.test(token)) {
        const [flag, inline] = token.includes("=") ? [token.slice(0, token.indexOf("=")), token.slice(token.indexOf("=") + 1)] : [token, null];
        const { arg, negated } = this.findOption(flag);
        seen.add(arg);
        if (arg.action === "store_true" || arg.action === "store_false" || arg.action === "BooleanOptional") {
          if (inline !== null) this.error(`argument ${arg.flags.join("/")}: ignored explicit argument '${inline}'`);
          ns[arg.dest] = arg.action === "store_false" ? false : arg.action === "BooleanOptional" ? !negated : true;
          i += 1;
          continue;
        }
        if (arg.nargs === "*") {
          const values: string[] = [];
          if (inline !== null) values.push(inline);
          let j = i + 1;
          while (inline === null && j < argv.length && !(argv[j].startsWith("-") && argv[j] !== "-" && !/^-\d/.test(argv[j]))) {
            values.push(argv[j]);
            j++;
          }
          ns[arg.dest] = values.map((v) => this.convert(arg, v));
          i = j;
          continue;
        }
        let value = inline;
        if (value === null) {
          if (i + 1 >= argv.length || (argv[i + 1].startsWith("-") && !/^-\d/.test(argv[i + 1]))) {
            this.error(`argument ${arg.flags.join("/")}: expected one argument`);
          }
          value = argv[i + 1];
          i += 2;
        } else {
          i += 1;
        }
        ns[arg.dest] = this.convert(arg, value);
        continue;
      }
      loose.push(token);
      i += 1;
    }
    this.assignPositionals(ns, positionals, loose);
    return this.finish(ns, seen, false);
  }

  private positionalCount(positionals: Argument[]): number {
    return positionals.filter((a) => !a.nargs).length;
  }

  private assignPositionals(ns: Namespace, positionals: Argument[], loose: string[]): void {
    const rest = [...loose];
    for (const a of positionals) {
      if (a.nargs === "*") {
        ns[a.dest] = rest.splice(0).map((v) => this.convert(a, v));
      } else if (a.nargs === "?") {
        if (rest.length) ns[a.dest] = this.convert(a, rest.shift()!);
      } else {
        if (!rest.length) this.error(`the following arguments are required: ${a.metavar ?? a.dest}`);
        ns[a.dest] = this.convert(a, rest.shift()!);
      }
    }
    if (rest.length) this.error(`unrecognized arguments: ${rest.join(" ")}`);
  }

  private finish(ns: Namespace, seen: Set<Argument>, hadCommand: boolean): Namespace {
    const missing = this.args.filter((a) => !a.positional && a.required && !seen.has(a));
    if (missing.length) {
      this.error(`the following arguments are required: ${missing.map((a) => a.flags.join("/")).join(", ")}`);
    }
    if (this.sub && this.sub.required && !hadCommand) {
      this.error(`the following arguments are required: ${this.sub.dest}`);
    }
    return ns;
  }

  private findOption(flag: string): { arg: Argument; negated: boolean } {
    const options = this.args.filter((a) => !a.positional);
    for (const a of options) {
      if (a.flags.includes(flag)) return { arg: a, negated: false };
      if (a.action === "BooleanOptional" && a.flags.some((f) => f.startsWith("--") && `--no-${f.slice(2)}` === flag)) {
        return { arg: a, negated: true };
      }
    }
    if (flag.startsWith("--")) {
      const candidates: { arg: Argument; negated: boolean; name: string }[] = [];
      for (const a of options) {
        for (const f of a.flags) {
          if (f.startsWith(flag)) candidates.push({ arg: a, negated: false, name: f });
          if (a.action === "BooleanOptional" && f.startsWith("--") && `--no-${f.slice(2)}`.startsWith(flag)) {
            candidates.push({ arg: a, negated: true, name: `--no-${f.slice(2)}` });
          }
        }
      }
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) {
        this.error(`ambiguous option: ${flag} could match ${candidates.map((c) => c.name).join(", ")}`);
      }
    }
    return this.error(`unrecognized arguments: ${flag}`);
  }

  private convert(a: Argument, raw: string): unknown {
    let value: unknown = raw;
    const name = a.positional ? a.metavar ?? a.dest : a.flags.join("/");
    if (a.type === "int") {
      if (!/^[-+]?\d+$/.test(raw.trim())) this.error(`argument ${name}: invalid int value: '${raw}'`);
      value = parseInt(raw, 10);
    } else if (a.type === "float") {
      const f = Number(raw);
      if (raw.trim() === "" || Number.isNaN(f)) this.error(`argument ${name}: invalid float value: '${raw}'`);
      value = f;
    } else if (typeof a.type === "function") {
      try {
        value = a.type(raw);
      } catch {
        this.error(`argument ${name}: invalid ${a.type.name || "value"} value: '${raw}'`);
      }
    }
    if (a.choices && !a.choices.includes(value)) {
      this.error(`argument ${name}: invalid choice: '${raw}' (choose from ${a.choices.map((c) => `'${c}'`).join(", ")})`);
    }
    return value;
  }
}

export class SubParsers {
  private parsers = new Map<string, ArgumentParser & { helpText: string }>();
  private readonly progBase: string;
  readonly dest: string;
  readonly required: boolean;

  constructor(progBase: string, dest: string, required: boolean) {
    this.progBase = progBase;
    this.dest = dest;
    this.required = required;
  }

  addParser(name: string, opts: ParserOptions = {}): ArgumentParser {
    const p = new ArgumentParser({ ...opts, prog: `${this.progBase} ${name}`, description: opts.description ?? opts.help }) as ArgumentParser & { helpText: string };
    p.helpText = opts.help ?? "";
    this.parsers.set(name, p);
    return p;
  }

  get(name: string): ArgumentParser | undefined {
    return this.parsers.get(name);
  }

  names(): string[] {
    return [...this.parsers.keys()];
  }

  entries(): [string, ArgumentParser & { helpText: string }][] {
    return [...this.parsers.entries()];
  }
}
