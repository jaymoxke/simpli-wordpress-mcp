import test from 'node:test';
import assert from 'node:assert/strict';
import {groundingRequirement,requiresLiveProductTruth,runAdvisor,validateGrounding,deriveEvidenceState,normalizeMcpOutput,AI_CONFIGURATION_ID} from '../src/openai.mjs';

const BASE_PACKET={
  primary_intent:'PRICE_AVAILABILITY',advisor_action:'ANSWER_DIRECT',specialist_route:'PRODUCT_INTELLIGENCE',control_state:'NONE',
  evidence_state:'CURRENT_COMMERCE_VERIFIED',risk_flags:[],handoff_required:false,questions_needed:[],answer_basis:['live product lookup'],
  customer_decision:'UNDECIDED',response_text:'KSh 1,000',outcome:null
};
const GOLDEN_INTELLIGENCE={state:'STATE_VERIFIED',admission:{all_passed:true}};
const REVIEW_INTELLIGENCE={state:'REVIEW_REQUIRED',admission:{all_passed:false}};
const MCP_LABEL='Simpli tool simpli_whatsapp_read completed.';
function packet(overrides={}){return{...BASE_PACKET,...overrides};}
function mcp(operation,{error=null,status=undefined,payload={},labeled=true}={}){const body=JSON.stringify({state:'STATE_VERIFIED',operation,...payload});return{type:'mcp_call',name:'simpli_whatsapp_read',server_label:'simpli',error,status,output:labeled?`${MCP_LABEL}\n${body}`:body};}
function productGet({admitted=true}={}){return mcp('PRODUCT_GET',{payload:{product_intelligence:admitted?GOLDEN_INTELLIGENCE:REVIEW_INTELLIGENCE}});}
function goldenList({admitted=true}={}){return mcp('GOLDEN_LIST',{payload:{items:admitted?[{product_intelligence:GOLDEN_INTELLIGENCE}]:[{product_intelligence:REVIEW_INTELLIGENCE}]}});}
function sourcingUnavailable(){return mcp('SOURCING_SEARCH',{payload:{state:'SOURCE_UNAVAILABLE',catalogue_available:false,evidence_class:'SUPPLIER_CATALOGUE_SIGNAL',items:[],returned:0,simpli_stock_assertion:false,purchase_promise:false,recommendation_authority:'NONE',commercial_cost_exposed:false,supplier_identity_exposed:false}});}
function sourcingVerified(overrides={}){return mcp('SOURCING_SEARCH',{payload:{state:'STATE_VERIFIED',catalogue_available:true,catalogue_date:'2026-08-24',catalogue_imported_gmt:'2026-08-24T00:00:00+00:00',evidence_class:'SUPPLIER_CATALOGUE_SIGNAL',items:[{brand:'Example Brand',product_name:'Exact Product',option_name:'50ml',sourcing_signal:'SUPPLIER_LISTING_PRESENT'}],returned:1,untrusted_supplier_rows_rejected:0,simpli_stock_assertion:false,purchase_promise:false,recommendation_authority:'NONE',commercial_cost_exposed:false,supplier_identity_exposed:false,...overrides}});}
function mockResponse(output=[],p=BASE_PACKET){return{ok:true,text:async()=>JSON.stringify({id:'resp_test',output,output_text:JSON.stringify(p)})};}

test('configuration identity is explicit',()=>assert.equal(AI_CONFIGURATION_ID,'SIMPLI_WA_LUNA_EPITOME_SHADOW_V3_ABW_SOURCING'));

test('normalizes the actual Simpli labeled MCP output string',()=>{
  const parsed=normalizeMcpOutput(`${MCP_LABEL}\n${JSON.stringify({state:'STATE_VERIFIED',operation:'PRODUCT_GET',product_intelligence:GOLDEN_INTELLIGENCE})}`);
  assert.equal(parsed.operation,'PRODUCT_GET');
  assert.equal(parsed.product_intelligence.admission.all_passed,true);
});

test('normalizes direct JSON and supported MCP content envelopes',()=>{
  assert.equal(normalizeMcpOutput(JSON.stringify({operation:'PRODUCT_SEARCH'})).operation,'PRODUCT_SEARCH');
  const wrapped={content:[{type:'text',text:`${MCP_LABEL}\n${JSON.stringify({operation:'GOLDEN_LIST',items:[]})}`}],structuredContent:{operation:'GOLDEN_LIST',items:[]}};
  assert.equal(normalizeMcpOutput(wrapped).operation,'GOLDEN_LIST');
});

test('truncated MCP output is not admitted as evidence',()=>{
  assert.equal(normalizeMcpOutput(`${MCP_LABEL}\n{"operation":"PRODUCT_GET"}\n\n[Output truncated: 300000 bytes total; limit 262144 bytes.]`),null);
});

test('grounding classifier distinguishes commerce detail comparison recommendation and sourcing',()=>{
  assert.equal(requiresLiveProductTruth('How much is Beauty of Joseon Relief Sun Aqua-Fresh?'),true);
  assert.equal(groundingRequirement('Is this in stock?').kind,'CURRENT_COMMERCE');
  assert.equal(groundingRequirement('What are the ingredients in this sunscreen?').kind,'PRODUCT_DETAIL');
  assert.equal(groundingRequirement('Compare this sunscreen vs the other one').kind,'PRODUCT_COMPARE');
  assert.equal(groundingRequirement('What should I buy for oily skin?').kind,'GOLDEN_RECOMMENDATION');
  assert.equal(groundingRequirement('Can you source Beauty of Joseon Revive Eye Serum for me?').kind,'SOURCING');
  assert.equal(groundingRequirement('Can you source me a sunscreen for oily skin?').kind,'GOLDEN_RECOMMENDATION');
  assert.equal(groundingRequirement('Hi').kind,'NONE');
});

test('adequate existing baseline is a KEEP decision before catalogue lookup',()=>{
  assert.deepEqual(
    groundingRequirement('My current sunscreen feels comfortable and I use it every morning without a problem. Which sunscreen should I buy instead?'),
    {required:false,kind:'EXISTING_ROUTINE_KEEP'}
  );
});

test('price question forces the safe MCP facade and stays stateless at OpenAI',async()=>{
  const original=globalThis.fetch;let requestBody;
  globalThis.fetch=async(_url,opts)=>{requestBody=JSON.parse(opts.body);return mockResponse([mcp('PRODUCT_SEARCH')]);};
  try{
    const result=await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'How much is Beauty of Joseon Relief Sun Aqua-Fresh?'}],conversationId:'conv-1',previousResponseId:'resp_old'});
    assert.deepEqual(requestBody.tool_choice,{type:'mcp',server_label:'simpli',name:'simpli_whatsapp_read'});
    assert.equal(requestBody.reasoning.effort,'low');
    assert.equal(requestBody.metadata.configuration_id,AI_CONFIGURATION_ID);
    assert.equal(requestBody.metadata.voice_version,'SIMPLI_HUMAN_ADVISOR_V1');
    assert.equal(requestBody.metadata.prompt_version,'WA_PROMPT_V6_GOVERNED_SOURCING');
    assert.equal(requestBody.metadata.toolset_version,'WHATSAPP_SAFE_READ_V3');
    assert.equal('previous_response_id' in requestBody,false);
    assert.equal(result.toolCalls[0].name,'simpli_whatsapp_read');
    assert.equal(result.toolCalls[0].output.operation,'PRODUCT_SEARCH');
    assert.equal(result.toolCalls[0].labeled_output,true);
    assert.equal(result.packet.evidence_state,'CURRENT_COMMERCE_VERIFIED');
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

test('exact product detail can answer only after admitted PRODUCT_GET',async()=>{
  const original=globalThis.fetch;
  const p=packet({primary_intent:'PRODUCT_INFO',evidence_state:'PARTIAL',response_text:'Use it as the final morning step.'});
  globalThis.fetch=async()=>mockResponse([mcp('PRODUCT_SEARCH'),productGet()],p);
  try{const result=await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'How to use this sunscreen?'}],conversationId:'conv-detail'});assert.equal(result.packet.evidence_state,'GOLDEN_PRODUCT_VERIFIED');assert.equal(result.toolCalls[1].output.product_intelligence.admission.all_passed,true);}finally{globalThis.fetch=original;}
});

test('non-Golden PRODUCT_GET cannot support a semantic direct answer',()=>{
  const p=packet({primary_intent:'PRODUCT_INFO',evidence_state:'GOLDEN_PRODUCT_VERIFIED',response_text:'This formula is ideal for you.'});
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'PRODUCT_DETAIL'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_GET',product_intelligence:REVIEW_INTELLIGENCE}}],packet:p}),/PRODUCT_DETAIL_EVIDENCE_INSUFFICIENT/);
});

test('exact product detail may abstain safely when exact Golden detail is unavailable',()=>{
  const p=packet({primary_intent:'PRODUCT_INFO',advisor_action:'ROUTE_PRODUCT_VERIFY',evidence_state:'UNKNOWN',handoff_required:true,response_text:'I can’t verify the exact formula yet.'});
  assert.equal(validateGrounding({requirement:{required:true,kind:'PRODUCT_DETAIL'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_GET',product_intelligence:REVIEW_INTELLIGENCE}}],packet:p}),true);
});

test('comparison cannot declare an answer from only one admitted exact product',()=>{
  const p=packet({primary_intent:'PRODUCT_COMPARISON',evidence_state:'GOLDEN_PRODUCT_VERIFIED',response_text:'Product A is better.'});
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'PRODUCT_COMPARE'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_GET',product_intelligence:GOLDEN_INTELLIGENCE}},{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_GET',product_intelligence:REVIEW_INTELLIGENCE}}],packet:p}),/PRODUCT_COMPARE_EVIDENCE_INSUFFICIENT/);
});

test('comparison with both admitted exact products is accepted and derives Golden evidence',()=>{
  const p=packet({primary_intent:'PRODUCT_COMPARISON',evidence_state:'PARTIAL',response_text:'A is lighter; B is richer.'});
  const toolCalls=[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_GET',product_intelligence:GOLDEN_INTELLIGENCE}},{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_GET',product_intelligence:GOLDEN_INTELLIGENCE}}];
  assert.equal(deriveEvidenceState({requirement:{required:true,kind:'PRODUCT_COMPARE'},toolCalls,packet:p}),'GOLDEN_PRODUCT_VERIFIED');
  assert.equal(validateGrounding({requirement:{required:true,kind:'PRODUCT_COMPARE'},toolCalls,packet:p}),true);
});

test('semantic evidence state is derived from server-proven Golden output rather than model self-label',()=>{
  const p=packet({primary_intent:'PRODUCT_INFO',evidence_state:'PARTIAL',response_text:'Use it once daily.'});
  const toolCalls=[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_GET',product_intelligence:GOLDEN_INTELLIGENCE}}];
  assert.equal(deriveEvidenceState({requirement:{required:true,kind:'PRODUCT_DETAIL'},toolCalls,packet:p}),'GOLDEN_PRODUCT_VERIFIED');
  assert.equal(validateGrounding({requirement:{required:true,kind:'PRODUCT_DETAIL'},toolCalls,packet:p}),true);
});

test('broad recommendation requires admitted Golden candidate evidence before ADD',()=>{
  const p=packet({primary_intent:'ROUTINE_GUIDANCE',advisor_action:'ANSWER_DIRECT',specialist_route:'ASK_SIMPLI_ROUTINE_INTELLIGENCE',evidence_state:'PARTIAL',customer_decision:'ADD',response_text:'Add the verified option after your baseline is stable.'});
  const good=[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'GOLDEN_LIST',items:[{product_intelligence:GOLDEN_INTELLIGENCE}]}}];
  assert.equal(deriveEvidenceState({requirement:{required:true,kind:'GOLDEN_RECOMMENDATION'},toolCalls:good,packet:p}),'GOLDEN_PRODUCT_VERIFIED');
  assert.equal(validateGrounding({requirement:{required:true,kind:'GOLDEN_RECOMMENDATION'},toolCalls:good,packet:p}),true);
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'GOLDEN_RECOMMENDATION'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'GOLDEN_LIST',items:[{product_intelligence:REVIEW_INTELLIGENCE}]}}],packet:p}),/GOLDEN_RECOMMENDATION_EVIDENCE_INSUFFICIENT/);
});

test('broad recommendation may ask a minimum question without pretending to select a product',()=>{
  const p=packet({primary_intent:'ROUTINE_GUIDANCE',advisor_action:'ASK_MINIMUM_QUESTION',specialist_route:'ASK_SIMPLI_ROUTINE_INTELLIGENCE',evidence_state:'UNKNOWN',questions_needed:['What is the one concern you want to target first?'],customer_decision:'UNDECIDED',response_text:'What is the one concern you want to target first?'});
  assert.equal(validateGrounding({requirement:{required:true,kind:'GOLDEN_RECOMMENDATION'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_SEARCH'}}],packet:p}),true);
});

test('ADD is rejected unless tool output itself proves admitted Golden evidence',()=>{
  const p=packet({evidence_state:'GOLDEN_PRODUCT_VERIFIED',customer_decision:'ADD'});
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'CURRENT_COMMERCE'},toolCalls:[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{operation:'PRODUCT_SEARCH'}}],packet:p}),/ADD_REQUIRES_GOLDEN_PRODUCT_EVIDENCE/);
});

test('explicit sourcing request forces safe facade and fails closed when catalogue is unavailable',async()=>{
  const original=globalThis.fetch;let requestBody;
  const p=packet({primary_intent:'GENERAL_OR_UNCLEAR',advisor_action:'ANSWER_DIRECT',specialist_route:'NONE',evidence_state:'UNKNOWN',customer_decision:'UNDECIDED',response_text:"I can't verify a sourcing option for that right now, so I don't want to promise it."});
  globalThis.fetch=async(_url,opts)=>{requestBody=JSON.parse(opts.body);return mockResponse([sourcingUnavailable()],p);};
  try{
    const result=await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'Can you source Beauty of Joseon Revive Eye Serum for me?'}],conversationId:'conv-source-missing'});
    assert.deepEqual(requestBody.tool_choice,{type:'mcp',server_label:'simpli',name:'simpli_whatsapp_read'});
    assert.equal(result.grounding.kind,'SOURCING');
    assert.equal(result.toolCalls[0].output.operation,'SOURCING_SEARCH');
    assert.equal(result.packet.primary_intent,'PRODUCT_SOURCING');
    assert.equal(result.packet.specialist_route,'SUPPLY_INVENTORY_INTELLIGENCE');
    assert.equal(result.packet.evidence_state,'UNKNOWN');
    assert.equal(result.packet.customer_decision,'UNDECIDED');
  }finally{globalThis.fetch=original;}
});

test('negated sourcing phrase does not become a false procurement promise',()=>{
  const output=JSON.parse(sourcingUnavailable().output.slice(MCP_LABEL.length).trim());
  const toolCalls=[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output}];
  for(const response_text of ["I can't confirm whether we can source that right now.","I can't confirm that we can source that yet."]){
    const p=packet({primary_intent:'PRODUCT_SOURCING',evidence_state:'UNKNOWN',customer_decision:'UNDECIDED',response_text});
    assert.equal(validateGrounding({requirement:{required:true,kind:'SOURCING'},toolCalls,packet:p}),true);
  }
});

test('positive redacted sourcing signal derives supplier evidence without authorizing a sale',async()=>{
  const original=globalThis.fetch;
  const p=packet({primary_intent:'PRODUCT_SOURCING',advisor_action:'ANSWER_DIRECT',specialist_route:'SUPPLY_INVENTORY_INTELLIGENCE',evidence_state:'PARTIAL',customer_decision:'UNDECIDED',response_text:'There may be a possible sourcing option for that exact product, but availability for Simpli is not confirmed yet.'});
  globalThis.fetch=async()=>mockResponse([sourcingVerified()],p);
  try{
    const result=await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'Could Simpli source Exact Product 50ml for me?'}],conversationId:'conv-source-positive'});
    assert.equal(result.packet.evidence_state,'SUPPLIER_SIGNAL_VERIFIED');
    assert.equal(result.packet.primary_intent,'PRODUCT_SOURCING');
    assert.equal(result.packet.specialist_route,'SUPPLY_INVENTORY_INTELLIGENCE');
    assert.notEqual(result.packet.customer_decision,'ADD');
  }finally{globalThis.fetch=original;}
});

test('sourcing signal is rejected if private supplier commercial fields leak into the tool packet',()=>{
  const p=packet({primary_intent:'PRODUCT_SOURCING',evidence_state:'SUPPLIER_SIGNAL_VERIFIED',customer_decision:'UNDECIDED',response_text:'There may be a possible sourcing option, but it is not confirmed.'});
  const toolCalls=[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output:{state:'STATE_VERIFIED',operation:'SOURCING_SEARCH',items:[],returned:0,simpli_stock_assertion:false,purchase_promise:false,recommendation_authority:'NONE',commercial_cost_exposed:false,supplier_identity_exposed:false,base_unit_price_usd:12.50}}];
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'SOURCING'},toolCalls,packet:p}),/SOURCING_BOUNDARY_VIOLATION/);
});

test('sourcing signal rejects raw supplier operational fields if the facade regresses',()=>{
  const p=packet({primary_intent:'PRODUCT_SOURCING',evidence_state:'SUPPLIER_SIGNAL_VERIFIED',customer_decision:'UNDECIDED',response_text:'There may be a possible sourcing option, but it is not confirmed.'});
  const output=JSON.parse(sourcingVerified().output.slice(MCP_LABEL.length).trim());
  output.items[0].supplier_lead_time_signal_days=14;
  output.items[0].mapping_state='UNMAPPED';
  const toolCalls=[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output}];
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'SOURCING'},toolCalls,packet:p}),/SOURCING_BOUNDARY_VIOLATION/);
});

test('sourcing signal is rejected if supplier identity exposure is enabled',()=>{
  const p=packet({primary_intent:'PRODUCT_SOURCING',evidence_state:'SUPPLIER_SIGNAL_VERIFIED',customer_decision:'UNDECIDED',response_text:'There may be a possible sourcing option, but it is not confirmed.'});
  const output={...JSON.parse(sourcingVerified({supplier_identity_exposed:true}).output.slice(MCP_LABEL.length).trim())};
  const toolCalls=[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output}];
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'SOURCING'},toolCalls,packet:p}),/SOURCING_BOUNDARY_VIOLATION/);
});

test('sourcing response cannot reveal ABW wholesale or USD commercial data',()=>{
  const output=JSON.parse(sourcingVerified().output.slice(MCP_LABEL.length).trim());
  const toolCalls=[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output}];
  const p=packet({primary_intent:'PRODUCT_SOURCING',evidence_state:'SUPPLIER_SIGNAL_VERIFIED',customer_decision:'UNDECIDED',response_text:'ABW has it at a wholesale price of $12, but availability is not confirmed.'});
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'SOURCING'},toolCalls,packet:p}),/SOURCING_PRIVATE_COMMERCIAL_LEAK/);
});

test('sourcing response cannot promise procurement or ETA from a supplier listing',()=>{
  const output=JSON.parse(sourcingVerified().output.slice(MCP_LABEL.length).trim());
  const toolCalls=[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output}];
  const p=packet({primary_intent:'PRODUCT_SOURCING',evidence_state:'SUPPLIER_SIGNAL_VERIFIED',customer_decision:'UNDECIDED',response_text:'We can source it and it will arrive in 14 days.'});
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'SOURCING'},toolCalls,packet:p}),/SOURCING_CERTAINTY_FORBIDDEN/);
});

test('supplier sourcing evidence can never authorize ADD',()=>{
  const output=JSON.parse(sourcingVerified().output.slice(MCP_LABEL.length).trim());
  const toolCalls=[{name:'simpli_whatsapp_read',server_label:'simpli',error:null,output}];
  const p=packet({primary_intent:'PRODUCT_SOURCING',evidence_state:'SUPPLIER_SIGNAL_VERIFIED',customer_decision:'ADD',response_text:'There may be a possible sourcing option, but it is not confirmed.'});
  assert.throws(()=>validateGrounding({requirement:{required:true,kind:'SOURCING'},toolCalls,packet:p}),/SOURCING_SIGNAL_CANNOT_AUTHORIZE_ADD/);
});

test('ordinary greeting keeps automatic tool choice',async()=>{
  const original=globalThis.fetch;let requestBody;
  const p=packet({primary_intent:'GENERAL_OR_UNCLEAR',advisor_action:'ANSWER_DIRECT',specialist_route:'NONE',evidence_state:'NOT_REQUIRED',answer_basis:[],response_text:'Hi — how can I help?',customer_decision:'UNDECIDED'});
  globalThis.fetch=async(_url,opts)=>{requestBody=JSON.parse(opts.body);return mockResponse([],p);};
  try{await runAdvisor({apiKey:'test-key',mcpUrl:'https://example.test/mcp',mcpToken:'test-token',messages:[{direction:'INBOUND',body:'Hi'}],conversationId:'conv-3',previousResponseId:'resp_old'});assert.equal(requestBody.tool_choice,'auto');assert.equal('previous_response_id' in requestBody,false);}finally{globalThis.fetch=original;}
});
