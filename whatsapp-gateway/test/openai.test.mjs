import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresLiveProductTruth,runAdvisor} from '../src/openai.mjs';

const PACKET={primary_intent:'PRICE_AVAILABILITY',advisor_action:'ANSWER_DIRECT',control_state:'NONE',risk_flags:[],handoff_required:false,answer_basis:['live product lookup'],response_text:'KSh 1,000',outcome:null};

function mockResponse(output=[]){return{ok:true,text:async()=>JSON.stringify({id:'resp_test',output,output_text:JSON.stringify(PACKET)})};}

test('current-state detector catches price and stock questions',()=>{
  assert.equal(requiresLiveProductTruth('How much is Beauty of Joseon Relief Sun Aqua-Fresh?'),true);
  assert.equal(requiresLiveProductTruth('Is this in stock?'),true);
  assert.equal(requiresLiveProductTruth('Hi'),false);
});

test('price question forces the safe MCP facade and accepts completed lookup',async()=>{
  const original=globalThis.fetch;
  let requestBody;
  globalThis.fetch=async(_url,opts)=>{requestBody=JSON.parse(opts.body);return mockResponse([{type:'mcp_call',name:'simpli_whatsapp_read',server_label:'simpli',status:'completed',output:'{}'}]);};
  try{
    const result=await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'How much is Beauty of Joseon Relief Sun Aqua-Fresh?'}],conversationId:'conv-1'});
    assert.deepEqual(requestBody.tool_choice,{type:'mcp',server_label:'simpli',name:'simpli_whatsapp_read'});
    assert.equal(result.toolCalls[0].name,'simpli_whatsapp_read');
  }finally{globalThis.fetch=original;}
});

test('current-state question fails closed when MCP lookup is skipped',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>mockResponse([]);
  try{
    await assert.rejects(()=>runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'What is the price of this sunscreen?'}],conversationId:'conv-2'}),/CURRENT_STATE_TOOL_REQUIRED_BUT_NOT_USED/);
  }finally{globalThis.fetch=original;}
});

test('ordinary greeting keeps automatic tool choice',async()=>{
  const original=globalThis.fetch;
  let requestBody;
  globalThis.fetch=async(_url,opts)=>{requestBody=JSON.parse(opts.body);return mockResponse([]);};
  try{
    await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'Hi'}],conversationId:'conv-3'});
    assert.equal(requestBody.tool_choice,'auto');
  }finally{globalThis.fetch=original;}
});
