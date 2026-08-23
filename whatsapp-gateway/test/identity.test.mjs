import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdvisor } from '../src/openai.mjs';

function packet(text) {
  return {
    primary_intent:'GENERAL_OR_UNCLEAR',
    advisor_action:'ANSWER_DIRECT',
    specialist_route:'NONE',
    control_state:'NONE',
    evidence_state:'NOT_REQUIRED',
    risk_flags:[],
    handoff_required:false,
    questions_needed:[],
    answer_basis:[],
    customer_decision:'UNDECIDED',
    response_text:text,
    outcome:null,
  };
}
function mockResponse(p) {
  return {ok:true,text:async()=>JSON.stringify({id:'resp_identity',output:[],output_text:JSON.stringify(p)})};
}

test('first advisor reply always introduces Simpli even if model omits the name', async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async()=>mockResponse(packet('How can I help you today?'));
  try {
    const result=await runAdvisor({apiKey:'test-key',messages:[{direction:'INBOUND',body:'Hi'}],conversationId:'conv-first'});
    assert.match(result.packet.response_text,/^Hi, I'm Simpli\./);
  } finally { globalThis.fetch=original; }
});

test('continuation reply does not force a repeated Simpli introduction', async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async()=>mockResponse(packet('Yes — tell me what you are currently using.'));
  try {
    const result=await runAdvisor({apiKey:'test-key',messages:[{direction:'OUTBOUND',body:"Hi, I'm Simpli. How can I help?"},{direction:'INBOUND',body:'Can you help with my routine?'}],conversationId:'conv-continuation'});
    assert.equal(result.packet.response_text,'Yes — tell me what you are currently using.');
  } finally { globalThis.fetch=original; }
});
