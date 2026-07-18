// Optional LLM mode for a translation-style agent. OFF by default: the demo is
// fully deterministic and $0, and never requires a paid key. It only activates
// when a FREE-TIER key is provided via LLM_API_KEY (Groq's free tier is
// OpenAI-compatible and needs no card; override LLM_API_URL / LLM_MODEL for
// another free provider).
export function isLlmEnabled(): boolean {
  return Boolean(process.env.LLM_API_KEY)
}

export interface TranslationResult {
  mode: 'llm' | 'deterministic'
  result: Record<string, string>
}

export async function translate(text: string, targetLangs: string[]): Promise<TranslationResult> {
  if (!isLlmEnabled()) {
    // Deterministic, $0, no external call — clearly labeled so it is never
    // mistaken for a real translation.
    return { mode: 'deterministic', result: Object.fromEntries(targetLangs.map((l) => [l, `[deterministic:${l}] ${text}`])) }
  }

  const url = process.env.LLM_API_URL || 'https://api.groq.com/openai/v1/chat/completions'
  const model = process.env.LLM_MODEL || 'llama-3.1-8b-instant'
  const result: Record<string, string> = {}
  for (const lang of targetLangs) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: 'user', content: `Translate the following into ${lang}. Output only the translation.\n\n${text}` }],
      }),
    })
    if (!res.ok) throw new Error(`LLM provider responded ${res.status}`)
    const json = (await res.json()) as { choices: { message: { content: string } }[] }
    result[lang] = json.choices[0].message.content.trim()
  }
  return { mode: 'llm', result }
}
