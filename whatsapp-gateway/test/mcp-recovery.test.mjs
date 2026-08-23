import test from 'node:test';
import assert from 'node:assert/strict';
import {runAdvisor} from '../src/openai.mjs';

const LABEL='Simpli tool simpli_whatsapp_read completed.';
const GOLDEN={state:'STATE_VERIFIED',admission:{all_passed:true}};
const PACKET={
  primary_intent:'ROUTINE_GUIDANCE',
  advisor_action:'ANSWER_DIRECT',
  specialist_route:'ASK_SIMPLI_ROUTINE_INTELLIGENCE',
  control_state:'NONE',
  evidence_state:'PARTIAL',
  risk_flags:[],
  handoff_required:false,
  questions_needed:[],
  answer_basis:['admitted Golden candidate'],
  customer_decision:'ADD',
  response_text:'Add the verified sunscreen as your final morning step.',
  outcome:null,
};

function response(output){
  return {ok:true,text:async()=>JSON.stringify({id:'resp_recovery',output,output_text:JSON.stringify(PACKET)})};
}

test('a failed MCP attempt may recover only when later admitted evidence satisfies the hard gate',async()=>{
  const original=globalThis.fetch;
  const failed={type:'mcp_call',name:'simpli_whatsapp_read',server_label:'simpli',status:'failed',error:'invalid arguments',output:{}};
  const goodPayload={state:'STATE_VERIFIED',operation:'GOLDEN_LIST',items:[{product_intelligence:GOLDEN}]};
  const recovered={type:'mcp_call',name:'simpli_whatsapp_read',server_label:'simpli',status:'completed',error:null,output:`${LABEL}\n${JSON.stringify(goodPayload)}`};
  globalThis.fetch=async()=>response([failed,recovered]);
  try{
    const result=await runAdvisor({
      apiKey:'test-key',
      mcpUrl:'https://example.test/mcp',
      mcpToken:'test-token',
      messages:[{direction:'INBOUND',body:'I have oily skin, a comfortable cleanser and moisturiser, no sunscreen, and want a simple routine. Which sunscreen should I buy?'}],
      conversationId:'recovery-case',
    });
    assert.equal(result.packet.evidence_state,'GOLDEN_PRODUCT_VERIFIED');
    assert.equal(result.packet.customer_decision,'ADD');
    assert.equal(result.toolCalls.length,2);
    assert.equal(result.toolCalls[0].error,'invalid arguments');
    assert.equal(result.toolCalls[1].output.operation,'GOLDEN_LIST');
  } finally {
    globalThis.fetch=original;
  }
});
