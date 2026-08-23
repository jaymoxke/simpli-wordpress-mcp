import { runAdvisor, AI_CONFIGURATION_ID } from './openai.mjs';
import { applyGreetingPolicy, greetingReplyLooksHuman } from './greeting-policy.mjs';

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

async function runCase(id, body, {humanGreeting=false}={}) {
  const inbound = { direction: 'INBOUND', message_type: 'text', body };
  const result = await runAdvisor({
    apiKey: env.OPENAI_API_KEY,
    model,
    messages: [inbound],
    conversationId: `selftest-simpli-identity-${id}`,
  });
  assert(!result.blocked, `${id}_ADVISOR_BLOCKED`);
  const packet = applyGreetingPolicy({text:body,messages:[inbound],packet:result.packet});
  const text = assertSimpliIdentity(packet?.response_text, id.toUpperCase());
  if(humanGreeting) {
    assert(greetingReplyLooksHuman(text), `${id}_NOT_HUMAN_GREETING`);
    assert(!/\b(?:acne|anua|niacinamide|sunscreen|cleanser|moisturi[sz]er|serum|toner|price|stock|routine|product|choose|checking)\b/i.test(text), `${id}_UNSOLICITED_MENU`);
    assert(text === "Hi 😊 I’m Simpli. How are you?", `${id}_GREETING_SHAPE_DRIFT`);
  }
  console.log(JSON.stringify({
    event: 'SIMPLI_IDENTITY_SELF_TEST_CASE',
    case_id: id,
    pass: true,
    configuration_id: result.configurationId || AI_CONFIGURATION_ID,
    model,
    identity: 'Simpli',
    final_customer_reply_chars: text.length,
    human_greeting: humanGreeting,
  }));
}

async function main() {
  assert(env.OPENAI_API_KEY, 'OPENAI_API_KEY_MISSING');
  await runCase('ordinary-first-reply', 'Hi', {humanGreeting:true});
  await runCase('reported-hi-simpli', 'Hi Simpli', {humanGreeting:true});
  await runCase('explicit-identity-question', 'Hi, who am I speaking to?');
  console.log(JSON.stringify({
    event: 'SIMPLI_IDENTITY_SELF_TEST',
    pass: true,
    configuration_id: AI_CONFIGURATION_ID,
    model,
    identity: 'Simpli',
    cases: 3,
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