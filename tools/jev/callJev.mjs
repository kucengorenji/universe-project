// Calls Jev (TypeSafe's decision model) through OpenRouter. Jev only picks: the answer is
// constrained to `options` with a JSON schema enum, so it can never invent a category.
// The request shape follows OpenRouter's structured outputs; check docs.typesafe.ai if Jev rejects it.
export const JEV_MODEL = 'typesafe/jev-1.13';

export async function callJev({ question, options, input, apiKey = process.env.OPENROUTER_API_KEY, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set (put it in .env, see tools/jev/README.md)');
  if (!Array.isArray(options) || options.length < 2) throw new Error('options needs at least two answers');
  const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: JEV_MODEL,
      messages: [
        { role: 'system', content: question },
        { role: 'user', content: input }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'decision',
          strict: true,
          schema: {
            type: 'object',
            properties: { choice: { type: 'string', enum: options } },
            required: ['choice'],
            additionalProperties: false
          }
        }
      }
    })
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const { choice } = JSON.parse(data.choices[0].message.content);
  if (!options.includes(choice)) throw new Error(`Jev answered "${choice}", which is not one of the options`);
  return { choice };
}
