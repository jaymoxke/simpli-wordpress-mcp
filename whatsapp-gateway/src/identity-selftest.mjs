import { runAdvisor, AI_CONFIGURATION_ID } from './openai.mjs';

const env = process.env;
const model = env.OPENAI_MODEL || 'gpt-5.6';

function assert(condition, code) {
  if (!condition) throw new Error(code);
}
function assertSimpliIdentity(text, codePrefix) {
  const value = String(text || '').trim();
  assert(/\b(?:i['’]?m|i am)\s+simpli\b/i.test(value), `${codePrefix}_NOT_SIMPLI`);
  assert(!/\b(?:luna|language model|chatbot|bot)\b/i.test(value), `${codePrefix}_INTERNAL_NAME_LEAK`);
  assert(value.length > 0 && value.length <= 500, `${codePrefix}_RESPONSE_LENGTH`);
  return value;
}

async function runCase(id, body) {
  const result = await runAdvisor({
    apiKey: env.OPENAI_API_KEY,
    model,
    messages: [{ direction: 'INBOUND', message_type: 'text', body }],
    conversationId: `selftest-simpli-identity-${id}`,
  });
  assert(!result.blocked, `${id}_ADVISOR_BLOCKED`);
  const text = assertSimpliIdentity(result.packet?.response_text, id.toUpperCase());
  console.log(JSON.stringify({
    event: 'SIMPLI_IDENTITY_SELF_TEST_CASE',
    case_id: id,
    pass: true,
    configuration_id: result.configurationId || AI_CONFIGURATION_ID,
    model,
    identity: 'Simpli',
    response_chars: text.length,
  }));
}

async function main() {
  assert(env.OPENAI_API_KEY, 'OPENAI_API_KEY_MISSING');
  await runCase('ordinary-first-reply', 'Hi');
  await runCase('explicit-identity-question', 'Hi, who am I speaking to?');
  console.log(JSON.stringify({
    event: 'SIMPLI_IDENTITY_SELF_TEST',
    pass: true,
    configuration_id: AI_CONFIGURATION_ID,
    model,
    identity: 'Simpli',
    cases: 2,
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
