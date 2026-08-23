import { runAdvisor, AI_CONFIGURATION_ID } from './openai.mjs';
import { applyGreetingPolicy, greetingReplyLooksHuman } from './greeting-policy.mjs';

const env = process.env;
const model = env.OPENAI_MODEL || 'gpt-5.6';

function assert(condition, code) {
  if (!condition) throw new Error(code);
}
function assertNoInternalIdentityLeak(text, codePrefix) {
  const value = String(text || '').trim();
  assert(!/\b(?:luna|language model|chatbot|bot)\b/i.test(value), `${codePrefix}_INTERNAL_NAME_LEAK`);
  assert(value.length > 0 && value.length <= 500, `${codePrefix}_RESPONSE_LENGTH`);
  return value;
}

async function runCase(id, body, {humanGreeting=false, customerAlreadyNamed=false, expectedGreeting=null, requireSelfIntro=false}={}) {
  const inbound = { direction: 'INBOUND', message_type: 'text', body };
  const result = await runAdvisor({
    apiKey: env.OPENAI_API_KEY,
    model,
    messages: [inbound],
    conversationId: `selftest-simpli-identity-${id}`,
  });
  assert(!result.blocked, `${id}_ADVISOR_BLOCKED`);
  const packet = applyGreetingPolicy({text:body,messages:[inbound],packet:result.packet});
  const text = assertNoInternalIdentityLeak(packet?.response_text, id.toUpperCase());
  if(requireSelfIntro) assert(/\b(?:i['’]?m|i am)\s+simpli\b/i.test(text), `${id}_NOT_SIMPLI`);
  if(customerAlreadyNamed) assert(!/\b(?:i['’]?m|i am)\s+simpli\b/i.test(text), `${id}_REPEATED_SIMPLI`);
  if(humanGreeting) {
    assert(greetingReplyLooksHuman(text,{identityAlreadyKnown:customerAlreadyNamed}), `${id}_NOT_HUMAN_GREETING`);
    assert(!/\b(?:acne|anua|niacinamide|sunscreen|cleanser|moisturi[sz]er|serum|toner|price|stock|routine|product|choose|checking)\b/i.test(text), `${id}_UNSOLICITED_MENU`);
    if(expectedGreeting) assert(text === expectedGreeting, `${id}_GREETING_SHAPE_DRIFT`);
  }
  console.log(JSON.stringify({
    event: 'SIMPLI_IDENTITY_SELF_TEST_CASE',
    case_id: id,
    pass: true,
    configuration_id: result.configurationId || AI_CONFIGURATION_ID,
    model,
    identity: 'Simpli',
    customer_already_named: customerAlreadyNamed,
    final_customer_reply_chars: text.length,
    human_greeting: humanGreeting,
  }));
}

async function main() {
  assert(env.OPENAI_API_KEY, 'OPENAI_API_KEY_MISSING');
  await runCase('ordinary-first-reply', 'Hi', {humanGreeting:true,requireSelfIntro:true,expectedGreeting:'Hi 😊 I’m Simpli. How are you?'});
  await runCase('reported-hi-simpli', 'Hi Simpli', {humanGreeting:true,customerAlreadyNamed:true,expectedGreeting:'Hi 😊 How are you?'});
  await runCase('explicit-identity-question', 'Hi, who am I speaking to?', {requireSelfIntro:true});
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
