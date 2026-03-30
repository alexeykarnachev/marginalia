// Fetch model context length from OpenRouter API. Cached per model.

const cache = new Map<string, number>();

export async function getModelContextLength(model: string, apiKey: string): Promise<number> {
  const cached = cache.get(model);
  if (cached) return cached;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const info = data.data?.find((m: any) => m.id === model);
    const ctx = info?.context_length || 0;
    if (ctx > 0) cache.set(model, ctx);
    return ctx;
  } catch {
    return 0;
  }
}
