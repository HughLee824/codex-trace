# codex-trace

Local web UI for inspecting Codex session traces.

`codex-trace` indexes Codex JSONL sessions from your machine and opens a browser UI for reviewing user messages, assistant responses, tool calls, raw events, and subagent parent/child traces. It is local-first: it reads local files and does not upload session data anywhere.

## Install

```bash
npm install -g codex-trace
```

Requires Node.js `22.11.0` or newer.

## Quick Start

```bash
codex-trace serve
```

Then open:

```text
http://127.0.0.1:17345
```

By default, `codex-trace` reads:

```text
~/.codex/sessions
~/.codex/session_index.jsonl
~/.codex/logs_2.sqlite
```

It writes its own index under:

```text
~/.codex-trace
```

## Commands

```bash
codex-trace serve
codex-trace reindex
codex-trace doctor
```

`serve` starts the local HTTP UI, indexes historical sessions, and tails new JSONL events.

`reindex` rebuilds the SQLite index from session files.

`doctor` checks whether the sessions directory, index path, and optional Codex log database are readable.

## Options

All commands accept the same path options:

```bash
codex-trace serve \
  --sessions ~/.codex/sessions \
  --session-index ~/.codex/session_index.jsonl \
  --logs ~/.codex/logs_2.sqlite \
  --trace-home ~/.codex-trace \
  --index ~/.codex-trace/index.sqlite \
  --live-state ~/.codex-trace/live-state.json \
  --port 17345
```

## UI

- Session gallery with search.
- Timeline view grouped around messages and raw events.
- Tool inspector for function calls, shell results, patch metadata, and failures.
- Subagent view with parent/child navigation.
- Live stream for appended session events.
- Raw JSON expansion for individual events.

## Privacy

`codex-trace` is designed for local inspection. It does not send session data to a remote service. The web server binds to `127.0.0.1` by default.

The UI redacts common secret-like values in normalized previews, but raw event expansion can reveal original local session content. Treat the local web UI as sensitive if your Codex sessions include private code, prompts, credentials, customer data, or logs.

## Development

```bash
pnpm test
pnpm serve
npm pack --dry-run
```

This project intentionally has no build step. The npm executable launches the TypeScript source through Node's `--experimental-strip-types` flag, so the package requires Node `22.11.0` or newer.

## License

Apache-2.0. See [LICENSE](LICENSE).
