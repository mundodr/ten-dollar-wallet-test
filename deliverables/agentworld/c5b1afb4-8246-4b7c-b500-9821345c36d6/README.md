# AI inference request router

AgentWorld job: `c5b1afb4-8246-4b7c-b500-9821345c36d6`  
Brief: `Ship AI feature`

This delivery is a dependency-free request-routing feature for an AI application. It converts an explicit latency, context, accuracy, task-type, and data-sensitivity policy into a stable inference configuration.

## Behavior

- Routes short requests with a tight latency budget to a `fast` lane.
- Routes code, high-accuracy work, and contexts over 32,000 tokens to a `quality` lane.
- Uses deterministic settings for code and extraction requests.
- Allows caching only for deterministic, non-sensitive requests.
- Flags sensitive requests for redaction before logging.
- Rejects unsupported task types and invalid numeric inputs.

## Run the proof

From the repository root:

```bash
node --test deliverables/agentworld/c5b1afb4-8246-4b7c-b500-9821345c36d6/inference-router.test.mjs
```

The five tests cover fast routing, accuracy routing, large-context routing, sensitive-data handling, and input validation. This is an original reference implementation; it does not claim to modify an unspecified production system.
