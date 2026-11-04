// The ONE place the provider chain is configured. Order comes from the bake-off, not preference:
// rule (owner, 2026-11-04): of Groq and Workers AI, both must score 100% injection-safety + intent;
// the lower p50 goes first; OpenRouter xing is third; the code layer (degraded reply) is always last.
// OpenRouter is called with ONE model per call (no `models` array) and only ":free" ids are accepted.
export const LAYERS = {
  // Groq (models API, 2026-11-04): llama-3.3-70b-versatile and llama-3.1-8b-instant are gone (404).
  groq_gptoss120: { provider: 'groq', model: 'openai/gpt-oss-120b', mode: 'json_schema', timeoutMs: 5000, maxTokens: 700,
    extra: { reasoning_effort: 'low', include_reasoning: false } },          // reasoning can only be lowered on gpt-oss
  groq_qwen27: { provider: 'groq', model: 'qwen/qwen3.8-27b', mode: 'json_schema', timeoutMs: 5000, maxTokens: 300,
    extra: { reasoning_effort: 'none' } },                                    // Groq docs: "none" disables reasoning on Qwen 3.8 27B
  groq_gptoss20: { provider: 'groq', model: 'openai/gpt-oss-20b', mode: 'json_schema', timeoutMs: 5000, maxTokens: 700,
    extra: { reasoning_effort: 'low', include_reasoning: false } },          // the small, fast one
  workers_ai: { provider: 'workers-ai', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', mode: 'json_schema', timeoutMs: 9000, maxTokens: 300 },
  or_xing: { provider: 'openrouter', model: 'xingchen-agi/xing4.0-29b-a4b:free', mode: 'json_schema', timeoutMs: 6000, maxTokens: 300,
    extra: { reasoning: { effort: 'none' } } },                               // only :free model on the public ZDR list
};

// From the round-2 bake-off (test/bakeoff-results.md): Groq gpt-oss-120b and Workers AI both 100% injection-safe
// and 100% intent; Groq has the lower p50 (853 ms vs 3170 ms) so it goes first. xing third (host 429s in round 1).
export const CHAIN = ['groq_gptoss120', 'workers_ai', 'or_xing'];

export const BUDGET = {
  totalMs: 15000,        // hard cap per message, enforced by the Worker
  hedgeAfterMs: 4000,    // start the next layer in parallel if the current one is silent this long
  minRetryLeftMs: 1500,  // retry (timeout/5xx only) only if at least this much budget remains
  breakerFails: 3,       // consecutive failures ...
  breakerSkipMs: 5 * 60 * 1000,   // ... skip the layer for 5 minutes
};
