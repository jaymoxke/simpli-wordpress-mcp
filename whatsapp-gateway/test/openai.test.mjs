import test from 'node:test';
import assert from 'node:assert/strict';
import {groundingRequirement,requiresLiveProductTruth,runAdvisor,validateGrounding,AI_CONFIGURATION_ID} from '../src/openai.mjs';

const BASE_PACKET={
  primary_intent:'PRICE_AVAILABILITY',advisor_action:'ANSWER_DIRECT',specialist_route:'PRODUCT_INTELLIGENCE',control_state:'NONE',
  evidence_state:'CURRENT_COMMERCE_VERIFIED',risk_flags:[],handoff_required:false,questions_needed:[],answer_basis:['live product lookup'],
  customer_decision:'UNDECIDED',response_text:'KSh 1,000',outcome:null
};
function packet(overrides={}){return{...BASE_PACKET,...overrides};}
function mcp(operation,{error=null,status=undefined}={}){return{type:'mcp_call',name:'simpli_whatsapp_read',server_label:'simpli',error,status,output:operation?JSON.stringify({state:'STATE_VERIFIED',operation}):'{}'};}
function mockResponse(output=[],p=BASE_PACKET){return{ok:true,text:async()=>JSON.stringify({id:'resp_test',output,output_text:JSON.stringify(p)})};}

test('configuration identity is explicit',()=>assert.equal(AI_CONFIGURATION_ID,'SIMPLI_WA_LUNA_EPITOME_SHADOW_V1'));

test('grounding classifier distinguishes commerce detail comparison and recommendation',()=>{
  assert.equal(requiresLiveProductTruth('How much is Beauty of Joseon Relief Sun Aqua-Fresh?'),true);
  assert.equal(groundingRequirement('Is this in stock?').kind,'CURRENT_COMMERCE');
  assert.equal(groundingRequirement('What are the ingredients in this sunscreen?').kind,'PRODUCT_DETAIL');
  assert.equal(groundingRequirement('Compare this sunscreen vs the other one').kind,'PRODUCT_COMPARE');
  assert.equal(groundingRequirement('What should I buy for oily skin?').kind,'GOLDEN_RECOMMENDATION');
  assert.equal(groundingRequirement('Hi').kind,'NONE');
});

test('price question forces the safe MCP facade and stays stateless at OpenAI',async()=>{
  const original=globalThis.fetch;let requestBody;
  globalThis.fetch=async(_url,opts)=>{requestBody=JSON.parse(opts.body);return mockResponse([mcp('PRODUCT_SEARCH')]);};
  try{
    const result=await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'How much is Beauty of Joseon Relief Sun Aqua-Fresh?'}],conversationId:'conv-1',previousResponseId:'resp_old'});
    assert.deepEqual(requestBody.tool_choice,{type:'mcp',server_label:'simpli',name:'simpli_whatsapp_read'});
    assert.equal(requestBody.reasoning.effort,'low');
    assert.equal(requestBody.metadata.configuration_id,AI_CONFIGURATION_ID);
    assert.equal('previous_response_id' in requestBody,false);
    assert.equal(result.toolCalls[0].name,'simpli_whatsapp_read');
  }finally{globalThis.fetch=original;}
});

test('grounded question fails closed when MCP is not configured',async()=>{
  await assert.rejects(()=>runAdvisor({apiKey:'test-key',messages:[{direction:'INBOUND',body:'What is the price of this sunscreen?'}],conversationId:'conv-no-mcp'}),/GROUNDED_TOOL_NOT_CONFIGURED/);
});

test('grounded question fails closed when MCP lookup is skipped',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>mockResponse([]);
  try{await assert.rejects(()=>runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'What is the price of this sunscreen?'}],conversationId:'conv-2'}),/GROUNDED_TOOL_REQUIRED_BUT_NOT_USED/);}finally{globalThis.fetch=original;}
});

test('grounded question fails closed when MCP returns an error',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>mockResponse([mcp('PRODUCT_SEARCH',{error:'backend failed'})]);
  try{await assert.rejects(()=>runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'Is it available?'}],conversationId:'conv-err'}),/GROUNDED_TOOL_FAILED/);}finally{globalThis.fetch=original;}
});

test('exact product detail can answer only after PRODUCT_GET',async()=>{
  const original=globalThis.fetch;
  const p=packet({primary_intent:'PRODUCT_INFO',evidence_state:'GOLDEN_PRODUCT_VERIFIED',response_text:'Use it as the final morning step.'});
  globalThis.fetch=async()=>mockResponse([mcp('PRODUCT_SEARCH'),mcp('PRODUCT_GET')],p);
  try{const result=await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'How to use this sunscreen?'}],conversationId:'conv-detail'});assert.equal(result.packet.evidence_state,'GOLDEN_PRODUCT_VERIFIED');}finally{globalThis.fetch=original;}
});

test('exact product detail may abstain safely when exact Golden detail is unavailable',()=>{
  const p=packet({primary_intent:'PRODUCT_INFO',advisor_action:'ROUTE_PRODUCT_VERIFY',evidence_state:'UNKNOWN',handoff_required:true,response_text:'I can’t verify the exact formula yet.'});
  assert.equal(validateGrounding({requirement:{required:true,kind:'PRODUCT_DETAIL'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_SEARCH'}}],packet:p}),true);
});

test('comparison cannot declare an answer from only one exact product',()=>{
  const p=packet({primary_intent:'PRODUCT_COMPARISON',evidence_state:'GOLDEN_PRODUCT_VERIFIED',response_text:'Product A is better.'});
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'PRODUCT_COMPARE'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_GET'}}],packet:p}),/PRODUCT_COMPARE_EVIDENCE_INSUFFICIENT/);
});

test('comparison with both exact products is accepted',()=>{
  const p=packet({primary_intent:'PRODUCT_COMPARISON',evidence_state:'GOLDEN_PRODUCT_VERIFIED',response_text:'A is lighter; B is richer.'});
  assert.equal(validateGrounding({requirement:{required:true,kind:'PRODUCT_COMPARE'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_GET'}},{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_GET'}}],packet:p}),true);
});

test('broad recommendation requires Golden candidate evidence before ADD',()=>{
  const p=packet({primary_intent:'ROUTINE_GUIDANCE',advisor_action:'ANSWER_DIRECT',specialist_route:'ASK_SIMPLI_ROUTINE_INTELLIGENCE',evidence_state:'GOLDEN_PRODUCT_VERIFIED',customer_decision:'ADD',response_text:'Add the verified option after your baseline is stable.'});
  assert.equal(validateGrounding({requirement:{required:true,kind:'GOLDEN_RECOMMENDATION'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'GOLDEN_LIST'}}],packet:p}),true);
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'GOLDEN_RECOMMENDATION'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_SEARCH'}}],packet:p}),/GOLDEN_RECOMMENDATION_EVIDENCE_INSUFFICIENT/);
});

test('broad recommendation may ask a minimum question without pretending to select a product',()=>{
  const p=packet({primary_intent:'ROUTINE_GUIDANCE',advisor_action:'ASK_MINIMUM_QUESTION',specialist_route:'ASK_SIMPLI_ROUTINE_INTELLIGENCE',evidence_state:'UNKNOWN',questions_needed:['What is the one concern you want to target first?'],customer_decision:'UNDECIDED',response_text:'What is the one concern you want to target first?'});
  assert.equal(validateGrounding({requirement:{required:true,kind:'GOLDEN_RECOMMENDATION'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_SEARCH'}}],packet:p}),true);
});

test('ADD is rejected without Golden product evidence even if another tool ran',()=>{
  const p=packet({evidence_state:'CURRENT_COMMERCE_VERIFIED',customer_decision:'ADD'});
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'CURRENT_COMMERCE'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_SEARCH'}}],packet:p}),/ADD_REQUIRES_GOLDEN_PRODUCT_EVIDENCE/);
});

test('ordinary greeting keeps automatic tool choice',async()=>{
  const original=globalThis.fetch;let requestBody;
  const p=packet({primary_intent:'GENERAL_OR_UNCLEAR',advisor_action:'ANSWER_DIRECT',specialist_route:'NONE',evidence_state:'NOT_REQUIRED',answer_basis:[],response_text:'Hi — how can I help?',customer_decision:'UNDECIDED'});
  globalThis.fetch=async(_url,opts)=>{requestBody=JSON.parse(opts.body);return mockResponse([],p);};
  try{await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'Hi'}],conversationId:'conv-3',previousResponseId:'resp_old'});assert.equal(requestBody.tool_choice,'auto');assert.equal('previous_response_id' in requestBody,false);}finally{globalThis.fetch=original;}
});
