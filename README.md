# fallcompass-sdk

Sovereign LLM cascade router. **8 providers · first success wins · BYOK.**

If your favourite LLM provider gates you, rate-limits you, or vanishes on a Sunday night, `fallcompass` keeps your tool alive. It tries providers in your preferred order. The first one that responds, wins.

- MIT · zero dependencies · works in Node, Deno, Bun, and the browser
- 8 adapters: `ollama`, `fallcore`, `anthropic`, `openrouter`, `gemini`, `openai`, `mistral`, `webllm`
- BYOK — keys never leave the caller's runtime (browser `localStorage` by default)

## Install

```bash
npm i @ai-native-solutions/fallcompass-sdk
```

Or drop the source file straight into your project — it's a single ES module with no dependencies.

## Quick start

```js
import fc from '@ai-native-solutions/fallcompass-sdk';

fc.setKey('anthropic', process.env.ANTHROPIC_API_KEY);

const r = await fc.chat({
  messages: [{ role: 'user', content: 'One line: why sovereign software wins.' }],
});

console.log(r.provider, r.ms, 'ms');
console.log(r.reply);
```

## API

### `chat({ messages, preferredOrder?, model?, maxTokens? })`

Runs the cascade. Returns `{ provider, label, reply, ms }`. Throws `Error('all providers failed')` with an `.attempts` array if every adapter failed.

- `messages` — OpenAI-style `[{ role, content }]`. `role: 'system'` messages are normalised per-provider (Anthropic `system:`, Gemini prepend, etc.).
- `preferredOrder` — override the default order. Example: `['webllm', 'ollama', 'anthropic']`.
- `model` — override the provider's default model.
- `maxTokens` — default `1024`.

### `probe(providers?)`

Returns `{ ollama: true, anthropic: false, ... }`. Cloud providers report `true` when a key is set; local providers are HTTP-probed with a 1.5s timeout; `webllm` reports `true` when `navigator.gpu` is present.

### `callProvider(name, { messages, model?, maxTokens? })`

Call one adapter directly, bypassing the cascade. Same return shape as `chat`.

### `setKey(provider, key)` · `getKey(provider)` · `clearKey(provider)`

Manage BYOK keys. Stored under `fallcompass.<provider>.key`. In Node, an in-memory shim is used.

### `listProviders()`

Returns `{ [name]: { label, free, default_model } }`.

### Constants

- `PROVIDERS` — full adapter config
- `DEFAULT_ORDER` — `['ollama','fallcore','anthropic','openrouter','gemini','openai','mistral','webllm']`
- `VERSION`

## Default cascade order

1. **ollama** — local server, free, no rate limit
2. **fallcore** — self-hosted Anthropic-compat proxy
3. **anthropic** — Claude
4. **openrouter** — has free-tier models
5. **gemini** — Google
6. **openai** — GPT-4o-mini
7. **mistral** — European
8. **webllm** — in-browser via `@mlc-ai/web-llm` · WebGPU · zero network

Override per-request:

```js
await fc.chat({
  messages,
  preferredOrder: ['ollama', 'fallcore'],  // on-prem only
});
```

## Playground

Browser demo lives at [`docs/index.html`](docs/index.html) and ships to GitHub Pages: <https://sjgant80-hub.github.io/fallcompass-sdk/>

## Companions

- **[fallcompass-mcp](https://github.com/sjgant80-hub/fallcompass-mcp)** — MCP server exposing cascade tools to Claude Code and other agents
- **[fallcompass-api](https://github.com/sjgant80-hub/fallcompass-api)** — HTTP wrapper (express + docker-compose) for language-agnostic use

## License

MIT · built by [AI Native Solutions](https://www.ai-nativesolutions.com).
