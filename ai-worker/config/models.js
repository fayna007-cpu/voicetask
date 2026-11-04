// The ONE place model ids and the provider chain live (the client shows `label`, never an id of its own).
// Order comes from the bake-off (test/bakeoff-results.md), not preference.
// OpenRouter is called with ONE model per call (no `models` array) and only ":free" ids are accepted.
// Quota skips are per LAYER (= per model); the network/5xx breaker is per PROVIDER (a Groq outage skips both Groq layers).
export const LAYERS = {
  // Groq (models API, 2026-11-04): llama-3.3-70b-versatile and llama-3.1-8b-instant are gone (404).
  groq_gptoss120: { provider: 'groq', label: 'Groq · GPT-OSS 120B', model: 'openai/gpt-oss-120b', mode: 'json_schema', timeoutMs: 5000, maxTokens: 700,
    extra: { reasoning_effort: 'low', include_reasoning: false } },          // reasoning can only be lowered on gpt-oss
  groq_gptoss20: { provider: 'groq', label: 'Groq · GPT-OSS 20B', model: 'openai/gpt-oss-20b', mode: 'json_schema', timeoutMs: 5000, maxTokens: 700,
    extra: { reasoning_effort: 'low', include_reasoning: false } },          // separate model = separate daily quota
  workers_ai: { provider: 'workers-ai', label: 'Workers AI · Llama 3.3 70B', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', mode: 'json_schema', timeoutMs: 9000, maxTokens: 300 },
  or_xing: { provider: 'openrouter', label: 'OpenRouter · Xing 4.0', model: 'xingchen-agi/xing4.0-29b-a4b:free', mode: 'json_schema', timeoutMs: 6000, maxTokens: 300,
    extra: { reasoning: { effort: 'none' } } },                               // only :free model on the public ZDR list
};

// Round 2: gpt-oss-120b and Workers AI both 100% injection-safe + intent; Groq has the lower p50 -> first.
// gpt-oss-20b (owner decision 2026-11-04) right after 120b; xing third-party fallback; code layer last.
export const CHAIN = ['groq_gptoss120', 'groq_gptoss20', 'workers_ai', 'or_xing'];

export const BUDGET = {
  totalMs: 15000,        // hard cap per message, enforced by the Worker
  hedgeAfterMs: 4000,    // start the next layer in parallel if the current one is silent this long
  minRetryLeftMs: 1500,  // retry (timeout/5xx only) only if at least this much budget remains
  breakerFails: 3,       // consecutive failures ...
  breakerSkipMs: 5 * 60 * 1000,      // ... skip for 5 minutes
  missingSkipMs: 24 * 60 * 60 * 1000, // a model that 404s is skipped for a day (and flagged in settings)
};
