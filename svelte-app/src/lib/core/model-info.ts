// Fetch model context length from OpenRouter API. Cached per model.

const cache = new Map<string, number>();
let allModels: any[] | null = null;

export async function getModelContextLength(model: string): Promise<number> {
  const cached = cache.get(model);
  if (cached) return cached;

  try {
    // Fetch model list once, cache it
    if (!allModels) {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      if (!res.ok) return 0;
      const data = await res.json();
      allModels = data.data || [];
    }

    // Try exact match first, then prefix match (handles dated variants like model-20251217)
    const info = allModels!.find((m: any) => m.id === model)
      || allModels!.find((m: any) => model.startsWith(m.id));
    const ctx = info?.context_length || 0;
    if (ctx > 0) cache.set(model, ctx);
    return ctx;
  } catch {
    return 0;
  }
}
