/**
 * fallcompass-sdk · sovereign LLM cascade router
 * 8 providers · first-success wins · BYOK · MIT
 * @ai-native-solutions/fallcompass-sdk
 */

const DEFAULT_ORDER = [
  'ollama', 'fallcore', 'anthropic', 'openrouter',
  'gemini', 'openai', 'mistral', 'webllm'
];

const PROVIDERS = {
  ollama: {
    label: 'Ollama (local)',
    free: true,
    default_model: 'llama3.2',
    probe_url: 'http://localhost:11434/api/tags',
    endpoint: 'http://localhost:11434/api/chat',
  },
  fallcore: {
    label: 'fallcore (self-hosted proxy)',
    free: true,
    default_model: 'claude-sonnet-4-5',
    probe_url: 'http://localhost:8787/health',
    endpoint: 'http://localhost:8787/v1/messages',
  },
  anthropic: {
    label: 'Anthropic Claude',
    free: false,
    default_model: 'claude-sonnet-4-5',
    endpoint: 'https://api.anthropic.com/v1/messages',
  },
  openrouter: {
    label: 'OpenRouter',
    free: false,
    default_model: 'meta-llama/llama-3.2-3b-instruct:free',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  },
  gemini: {
    label: 'Google Gemini',
    free: false,
    default_model: 'gemini-1.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
  },
  openai: {
    label: 'OpenAI',
    free: false,
    default_model: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  mistral: {
    label: 'Mistral',
    free: false,
    default_model: 'mistral-small-latest',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
  },
  webllm: {
    label: 'WebLLM (in-browser)',
    free: true,
    default_model: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  },
};

const KEY_PREFIX = 'fallcompass.';

const __memStore = {};
const __memShim = {
  getItem: (k) => (k in __memStore ? __memStore[k] : null),
  setItem: (k, v) => { __memStore[k] = String(v); },
  removeItem: (k) => { delete __memStore[k]; },
};
function getStorage() {
  try {
    if (typeof localStorage !== 'undefined'
        && localStorage
        && typeof localStorage.getItem === 'function'
        && typeof localStorage.setItem === 'function') {
      return localStorage;
    }
  } catch (_) { /* access can throw in sandboxed contexts */ }
  return __memShim;
}

function getKey(provider) {
  return getStorage().getItem(KEY_PREFIX + provider + '.key');
}
function setKey(provider, key) {
  if (!PROVIDERS[provider]) throw new Error('unknown provider: ' + provider);
  getStorage().setItem(KEY_PREFIX + provider + '.key', key);
}
function clearKey(provider) {
  getStorage().removeItem(KEY_PREFIX + provider + '.key');
}

function listProviders() {
  const out = {};
  for (const [k, v] of Object.entries(PROVIDERS)) {
    out[k] = { label: v.label, free: v.free, default_model: v.default_model };
  }
  return out;
}

async function probe(providers) {
  const list = providers || Object.keys(PROVIDERS);
  const results = {};
  await Promise.all(list.map(async (p) => {
    results[p] = await probeOne(p);
  }));
  return results;
}

async function probeOne(provider) {
  const cfg = PROVIDERS[provider];
  if (!cfg) return false;
  if (provider === 'webllm') {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }
  if (cfg.probe_url) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(cfg.probe_url, { signal: ctrl.signal });
      clearTimeout(t);
      return r.ok;
    } catch (_) { return false; }
  }
  // Cloud providers: reachable if key is set
  return !!getKey(provider);
}

// ─── Adapters ──────────────────────────────────────────────────

async function callOllama(messages, model, maxTokens) {
  const r = await fetch(PROVIDERS.ollama.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model || PROVIDERS.ollama.default_model,
      messages,
      stream: false,
      options: { num_predict: maxTokens },
    }),
  });
  if (!r.ok) throw new Error('ollama ' + r.status);
  const j = await r.json();
  return j.message?.content || '';
}

async function callFallcore(messages, model, maxTokens) {
  const key = getKey('fallcore') || '';
  const sys = extractSystem(messages);
  const user = messages.filter(m => m.role !== 'system');
  const r = await fetch(PROVIDERS.fallcore.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
    body: JSON.stringify({
      model: model || PROVIDERS.fallcore.default_model,
      max_tokens: maxTokens,
      system: sys,
      messages: user,
    }),
  });
  if (!r.ok) throw new Error('fallcore ' + r.status);
  const j = await r.json();
  return j.content?.[0]?.text || '';
}

async function callAnthropic(messages, model, maxTokens) {
  const key = getKey('anthropic');
  if (!key) throw new Error('anthropic: no key');
  const sys = extractSystem(messages);
  const user = messages.filter(m => m.role !== 'system');
  const r = await fetch(PROVIDERS.anthropic.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || PROVIDERS.anthropic.default_model,
      max_tokens: maxTokens,
      system: sys,
      messages: user,
    }),
  });
  if (!r.ok) throw new Error('anthropic ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return j.content[0].text;
}

async function callOpenRouter(messages, model, maxTokens) {
  const key = getKey('openrouter');
  if (!key) throw new Error('openrouter: no key');
  const r = await fetch(PROVIDERS.openrouter.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model || PROVIDERS.openrouter.default_model,
      max_tokens: maxTokens,
      messages,
    }),
  });
  if (!r.ok) throw new Error('openrouter ' + r.status);
  const j = await r.json();
  return j.choices[0].message.content;
}

async function callGemini(messages, model, maxTokens) {
  const key = getKey('gemini');
  if (!key) throw new Error('gemini: no key');
  const m = model || PROVIDERS.gemini.default_model;
  const sys = extractSystem(messages);
  const user = messages.filter(x => x.role !== 'system').map(x => x.content).join('\n\n');
  const body = {
    contents: [{ role: 'user', parts: [{ text: (sys ? sys + '\n\n---\n\n' : '') + user }] }],
    generationConfig: { maxOutputTokens: maxTokens },
  };
  const r = await fetch(PROVIDERS.gemini.endpoint + m + ':generateContent?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('gemini ' + r.status);
  const j = await r.json();
  return j.candidates[0].content.parts[0].text;
}

async function callOpenAI(messages, model, maxTokens) {
  const key = getKey('openai');
  if (!key) throw new Error('openai: no key');
  const r = await fetch(PROVIDERS.openai.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model || PROVIDERS.openai.default_model,
      max_tokens: maxTokens,
      messages,
    }),
  });
  if (!r.ok) throw new Error('openai ' + r.status);
  const j = await r.json();
  return j.choices[0].message.content;
}

async function callMistral(messages, model, maxTokens) {
  const key = getKey('mistral');
  if (!key) throw new Error('mistral: no key');
  const r = await fetch(PROVIDERS.mistral.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model || PROVIDERS.mistral.default_model,
      max_tokens: maxTokens,
      messages,
    }),
  });
  if (!r.ok) throw new Error('mistral ' + r.status);
  const j = await r.json();
  return j.choices[0].message.content;
}

async function callWebLLM(messages, model, maxTokens) {
  if (typeof window === 'undefined') throw new Error('webllm: browser only');
  if (!navigator.gpu) throw new Error('webllm: no WebGPU');
  const modelId = model || PROVIDERS.webllm.default_model;
  if (!globalThis.__fallcompass_webllm_engine__ || globalThis.__fallcompass_webllm_model__ !== modelId) {
    const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm@0.2.79');
    globalThis.__fallcompass_webllm_engine__ = await CreateMLCEngine(modelId);
    globalThis.__fallcompass_webllm_model__ = modelId;
  }
  const engine = globalThis.__fallcompass_webllm_engine__;
  const r = await engine.chat.completions.create({ messages, max_tokens: maxTokens });
  return r.choices[0].message.content;
}

function extractSystem(messages) {
  const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  return sys || undefined;
}

const ADAPTERS = {
  ollama: callOllama,
  fallcore: callFallcore,
  anthropic: callAnthropic,
  openrouter: callOpenRouter,
  gemini: callGemini,
  openai: callOpenAI,
  mistral: callMistral,
  webllm: callWebLLM,
};

// ─── Cascade ──────────────────────────────────────────────────

async function chat(opts) {
  opts = opts || {};
  const messages = opts.messages || [];
  const order = opts.preferredOrder || DEFAULT_ORDER;
  const maxTokens = opts.maxTokens || 1024;
  const model = opts.model;
  const errors = [];

  for (const provider of order) {
    const adapter = ADAPTERS[provider];
    if (!adapter) { errors.push(provider + ': unknown provider'); continue; }
    const t0 = Date.now();
    try {
      const reply = await adapter(messages, model, maxTokens);
      if (!reply) throw new Error('empty reply');
      return {
        provider,
        label: PROVIDERS[provider].label,
        reply,
        ms: Date.now() - t0,
      };
    } catch (e) {
      errors.push(provider + ': ' + e.message);
    }
  }
  const err = new Error('all providers failed');
  err.attempts = errors;
  throw err;
}

async function callProvider(provider, opts) {
  opts = opts || {};
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error('unknown provider: ' + provider);
  const t0 = Date.now();
  const reply = await adapter(opts.messages || [], opts.model, opts.maxTokens || 1024);
  return { provider, label: PROVIDERS[provider].label, reply, ms: Date.now() - t0 };
}

const VERSION = '1.0.0';

export {
  chat, probe, probeOne, callProvider,
  setKey, getKey, clearKey,
  listProviders, PROVIDERS, DEFAULT_ORDER, VERSION,
};

export default {
  chat, probe, probeOne, callProvider,
  setKey, getKey, clearKey,
  listProviders, PROVIDERS, DEFAULT_ORDER, VERSION,
};
