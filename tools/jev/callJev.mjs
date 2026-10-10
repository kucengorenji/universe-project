// Calls Jev (TypeSafe's decision model) through OpenRouter's Decisions endpoint. Jev rejects
// chat/completions; it takes the content as `state` plus named typed questions, and answers each
// question under the same key. The endpoint is alpha and may change shape.
export const JEV_MODEL = 'typesafe/jev-1.13';
export const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';

/**
 * Asks Jev several typed questions about one `state` in a single call and returns `answers`, keyed like `questions`.
 * Question types: 'choice' (one label from `criteria`), 'noul' (yes/no probability), 'score' (level on a scale).
 */
export async function askJev({ state, questions, apiKey = process.env.OPENROUTER_API_KEY, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set (put it in .env, see tools/jev/README.md)');
  const res = await fetchImpl(JEV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: JEV_MODEL, state, questions })
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data?.answers || Object.keys(questions).some(k => !data.answers[k])) {
    throw new Error(`Unexpected Jev response: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data.answers;
}

/**
 * Asks one choice question. `options` maps each allowed label to a short description of when it applies.
 * Returns { choice, confidence, probabilities } as Jev reports them.
 */
export async function callJev({ question, options, input, apiKey = process.env.OPENROUTER_API_KEY, fetchImpl = fetch }) {
  const labels = Object.keys(options ?? {});
  if (labels.length < 2) throw new Error('options needs at least two labels');
  const answers = await askJev({
    state: input,
    questions: { decision: { type: 'choice', instructions: question, criteria: options } },
    apiKey, fetchImpl
  });
  const answer = answers.decision;
  if (typeof answer.choice !== 'string') throw new Error(`Unexpected Jev response: ${JSON.stringify(answers).slice(0, 400)}`);
  if (!labels.includes(answer.choice)) throw new Error(`Jev answered "${answer.choice}", which is not one of the options`);
  return { choice: answer.choice, confidence: answer.confidence ?? null, probabilities: answer.probabilities ?? null };
}
