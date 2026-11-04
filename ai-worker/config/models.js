// The ONE place the provider chain is configured. Order is decided by the bake-off
// (scripts/bakeoff.mjs), not by preference. Only ":free" OpenRouter ids are ever accepted.
export default {
  // Candidates from GET /api/v1/models (2026-11-04): the only :free models advertising structured_outputs.
  // Eligibility is re-checked live against the owner's account filter (/api/v1/models/user).
  openrouterCandidates: [
    'xingchen-agi/xing4.0-29b-a4b:free',      // the only one also on the public ZDR list (host: Phala)
    'nvidia/nemotron-3.5-super-vl:free',
    'dots-studio/dots-3-note-preview:free',
    'liquid/lfm-2.5-2.6b:free',               // 2.6B — kept only so the bake-off can measure it
  ],
  // Final chain, filled in after the bake-off. Until then the gateway serves nothing.
  chain: [],
  workersAiModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',   // listed on the Workers AI JSON Mode page
  budgetMs: 15000,       // total per message
  layerTimeoutMs: 6000,  // per layer
  hedgeAfterMs: 4000,    // start the next layer in parallel if the current one is silent this long
};
