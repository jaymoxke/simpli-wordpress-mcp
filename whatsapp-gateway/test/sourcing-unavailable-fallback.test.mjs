import test from 'node:test';
import assert from 'node:assert/strict';
import {runAdvisor} from '../src/openai.mjs';

const MCP_LABEL='Simpli tool simpli_whatsapp_read completed.';
const SOURCE_UNAVAILABLE={
  state:'SOURCE_UNAVAILABLE',
  operation:'SOURCING_SEARCH',
  catalogue_available:false,
  evidence_class:'SUPPLIER_CATALOGUE_SIGNAL',
  items:[],
  returned:0,
  simpli_stock_assertion:false,
  purchase_promise:false,
  recommendation_authority:'NONE',
  commercial_cost_exposed:false,
  supplier_identity_exposed:false,
};

function unsafeModelPacket(){
  return {
    primary_intent:'PRODUCT_SOURCING',
    advisor_action:'ANSWER_DIRECT',
    specialist_route:'SUPPLY_INVENTORY_INTELLIGENCE',
    control_state:'NONE',
    evidence_state:'UNKNOWN',
    risk_flags:[],
    handoff_required:false,
    questions_needed:[],
    answer_basis:['supplier lookup'],
    customer_decision:'UNDECIDED',
    response_text:'We can source it for you.',
    outcome:null,
  };
}

test('SOURCE_UNAVAILABLE deterministically replaces unsafe model procurement wording',async()=>{
  const original=globalThis.fetch;
  const mcpCall={
    type:'mcp_call',
    name:'simpli_whatsapp_read',
    server_label:'simpli',
    status:'completed',
    output:`${MCP_LABEL}\n${JSON.stringify(SOURCE_UNAVAILABLE)}`,
  };
  globalThis.fetch=async()=>({
    ok:true,
    text:async()=>JSON.stringify({
      id:'resp_source_unavailable',
      output:[mcpCall],
      output_text:JSON.stringify(unsafeModelPacket()),
    }),
  });
  try{
    const result=await runAdvisor({
      apiKey:'test-key',
      mcpUrl:'https://example.test/mcp',
      mcpToken:'test-token',
      messages:[{direction:'INBOUND',message_type:'text',body:'Can you source Round Lab Dokdo Eye Cream for me?'}],
      conversationId:'conv-source-unavailable-fallback',
    });
    assert.equal(result.grounding.kind,'SOURCING');
    assert.equal(result.packet.primary_intent,'PRODUCT_SOURCING');
    assert.equal(result.packet.specialist_route,'SUPPLY_INVENTORY_INTELLIGENCE');
    assert.equal(result.packet.control_state,'CURRENT_STATE_REQUIRED');
    assert.equal(result.packet.evidence_state,'UNKNOWN');
    assert.equal(result.packet.customer_decision,'UNDECIDED');
    assert.match(result.packet.response_text,/I can't verify a sourcing option for that right now, so I don't want to promise it\./);
    assert.doesNotMatch(result.packet.response_text,/\bwe can source it\b/i);
  }finally{
    globalThis.fetch=original;
  }
});
