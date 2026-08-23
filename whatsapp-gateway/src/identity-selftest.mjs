import { runAdvisor, AI_CONFIGURATION_ID } from './openai.mjs';

const env = process.env;
const model = env.OPENAI_MODEL || 'gpt-5.6';

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

async function main() {
  assert(env.OPENAI_API_KEY, 'OPENAI_API_KEY_MISSING');

  const result = await runAdvisor({
    apiKey: env.OPENAI_API_KEY,
    model,
    messages: [{ direction: 'INBOUND', message_type: 'text', body: 'Hi, who am I speaking to?' }],
    conversationId: 'selftest-simpli-identity',
  });

  assert(!result.blocked, 'IDENTITY_ADVISOR_BLOCKED');
  const text = String(result.packet?.response_text || '').trim();
  assert(/\b(?:i['’]?m|i am)\s+simpli\b/i.test(text), 'IDENTITY_NOT_SIMPLI');
  assert(!/\b(?:luna|language model|chatbot|bot)\b/i.test(text), 'IDENTITY_INTERNAL_NAME_LEAK');
  assert(text.length > 0 && text.length <= 400, 'IDENTITY_RESPONSE_LENGTH');

  console.log(JSON.stringify({
    event: 'SIMPLI_IDENTITY_SELF_TEST',
    pass: true,
    configuration_id: result.configurationId || AI_CONFIGURATION_ID,
    model,
    identity: 'Simpli',
    response_chars: text.length,
  }));
}

main().catch(error => {
  console.error(JSON.stringify({
    event: 'SIMPLI_IDENTITY_SELF_TEST',
    pass: false,
    configuration_id: AI_CONFIGURATION_ID,
    model,
    error: String(error?.message || error).slice(0, 300),
  }));
  process.exitCode = 1;
});
