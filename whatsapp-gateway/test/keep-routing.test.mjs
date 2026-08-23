import test from 'node:test';
import assert from 'node:assert/strict';
import {groundingRequirement,runAdvisor} from '../src/openai.mjs';

const keepText='My current sunscreen feels comfortable and I use it every morning without a problem. Which sunscreen should I buy instead?';

function packet(overrides={}){
  return {
    primary_intent:'ROUTINE_GUIDANCE',advisor_action:'ANSWER_DIRECT',specialist_route:'NONE',control_state:'NONE',
    evidence_state:'NOT_REQUIRED',risk_flags:[],handoff_required:false,questions_needed:[],answer_basis:['current routine context'],
    customer_decision:'KEEP',response_text:'If your current sunscreen is comfortable and you use it consistently, keep it. You do not need to replace it just to buy something new.',outcome:null,
    ...overrides,
  };
}
function mockResponse(p){return{ok:true,text:async()=>JSON.stringify({id:'resp_keep',output:[],output_text:JSON.stringify(p)})};}

test('same-category adequate sunscreen resolves to existing-routine KEEP',()=>{
  assert.deepEqual(groundingRequirement(keepText),{required:false,kind:'EXISTING_ROUTINE_KEEP'});
});

test('comfortable cleanser and moisturiser do not suppress a genuinely missing sunscreen recommendation',()=>{
  const text='I have oily skin. My cleanser and moisturiser are comfortable, I do not own a sunscreen yet, and I want a simple routine. Which sunscreen should I buy?';
  assert.deepEqual(groundingRequirement(text),{required:true,kind:'GOLDEN_RECOMMENDATION'});
});

test('a real unmet sunscreen need still requires governed recommendation evidence',()=>{
  const text='My current sunscreen is comfortable but leaves a white cast. Which sunscreen should I buy instead?';
  assert.deepEqual(groundingRequirement(text),{required:true,kind:'GOLDEN_RECOMMENDATION'});
});

test('true KEEP turn does not expose the product catalogue and derives existing-routine intent',async()=>{
  const original=globalThis.fetch;let body;
  globalThis.fetch=async(_url,opts)=>{body=JSON.parse(opts.body);return mockResponse(packet());};
  try{
    const result=await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:keepText}],conversationId:'keep-1'});
    assert.equal('tools' in body,false);
    assert.equal('tool_choice' in body,false);
    assert.equal(result.grounding.kind,'EXISTING_ROUTINE_KEEP');
    assert.equal(result.packet.primary_intent,'EXISTING_ROUTINE_DECISION');
    assert.equal(result.packet.evidence_state,'NOT_REQUIRED');
    assert.equal(result.packet.customer_decision,'KEEP');
    assert.equal(result.toolCalls.length,0);
  } finally { globalThis.fetch=original; }
});

test('true KEEP turn cannot be converted into an ADD sale',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>mockResponse(packet({customer_decision:'ADD',response_text:'Buy another sunscreen.'}));
  try{
    await assert.rejects(()=>runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:keepText}],conversationId:'keep-2'}),/KEEP_CONTEXT_ADD_FORBIDDEN/);
  } finally { globalThis.fetch=original; }
});
