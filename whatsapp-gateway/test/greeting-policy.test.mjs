import test from 'node:test';
import assert from 'node:assert/strict';
import {applyGreetingPolicy, canonicalFirstGreeting, customerAlreadyNamedSimpli, greetingReplyLooksHuman, isPureGreeting, removeRedundantSelfIntroduction} from '../src/greeting-policy.mjs';

const packet={
  primary_intent:'GENERAL_OR_UNCLEAR',advisor_action:'ASK_MINIMUM_QUESTION',specialist_route:'NONE',control_state:'NONE',
  evidence_state:'NOT_REQUIRED',risk_flags:[],handoff_required:false,questions_needed:[],answer_basis:[],customer_decision:'UNDECIDED',
  response_text:'Hi, I’m Simpli 😊 What would you like help with today—choosing an acne-friendly product, checking the price of Anua Niacinamide, or something else?',outcome:null
};

test('recognises greeting-only openings without treating a real question as a greeting',()=>{
  assert.equal(isPureGreeting('Hi Simpli'),true);
  assert.equal(isPureGreeting('Good morning Simpli!'),true);
  assert.equal(isPureGreeting('Hi Simpli, how much is the Anua serum?'),false);
});

test('recognises when customer already addressed Simpli by name',()=>{
  assert.equal(customerAlreadyNamedSimpli('Hi Simpli'),true);
  assert.equal(customerAlreadyNamedSimpli('Good morning'),false);
});

test('first greeting does not repeat Simpli when customer already used the name',()=>{
  const result=applyGreetingPolicy({text:'Hi Simpli',messages:[{direction:'INBOUND',body:'Hi Simpli'}],packet});
  assert.equal(result.response_text,'Hi 😊 How are you?');
  assert.equal(result.primary_intent,'GENERAL_OR_UNCLEAR');
  assert.equal(result.advisor_action,'ANSWER_DIRECT');
  assert.equal(result.customer_decision,'UNDECIDED');
  assert.equal(greetingReplyLooksHuman(result.response_text,{identityAlreadyKnown:true}),true);
  assert.doesNotMatch(result.response_text,/I(?:'|’)?m Simpli|I am Simpli/i);
  assert.doesNotMatch(result.response_text,/acne|Anua|niacinamide|price|product|routine|choose/i);
});

test('first unnamed greeting introduces Simpli once',()=>{
  const result=applyGreetingPolicy({text:'Hi',messages:[{direction:'INBOUND',body:'Hi'}],packet});
  assert.equal(result.response_text,'Hi 😊 I’m Simpli. How are you?');
  assert.equal(greetingReplyLooksHuman(result.response_text),true);
});

test('time-of-day greeting avoids name echo but still introduces when needed',()=>{
  assert.equal(canonicalFirstGreeting('Good morning Simpli!'),'Good morning 😊 How are you?');
  assert.equal(canonicalFirstGreeting('Good morning'),'Good morning 😊 I’m Simpli. How are you?');
});

test('named real question removes only redundant self-introduction, not the answer',()=>{
  const namedQuestionPacket={...packet,primary_intent:'PRICE_AVAILABILITY',advisor_action:'ANSWER_DIRECT',response_text:"Hi, I'm Simpli. The Anua serum is KSh 2,500 and currently in stock."};
  const result=applyGreetingPolicy({text:'Hi Simpli, how much is the Anua serum?',messages:[{direction:'INBOUND',body:'Hi Simpli, how much is the Anua serum?'}],packet:namedQuestionPacket});
  assert.equal(result.response_text,'Hi 😊 The Anua serum is KSh 2,500 and currently in stock.');
  assert.equal(result.primary_intent,'PRICE_AVAILABILITY');
  assert.equal(result.advisor_action,'ANSWER_DIRECT');
  assert.doesNotMatch(result.response_text,/I(?:'|’)?m Simpli|I am Simpli/i);
});

test('redundant self-intro remover handles intro without a greeting lead',()=>{
  assert.equal(removeRedundantSelfIntroduction("I'm Simpli. The price is KSh 2,500."),'The price is KSh 2,500.');
});

test('continuation greeting is not overwritten',()=>{
  const result=applyGreetingPolicy({text:'Hi Simpli',messages:[{direction:'OUTBOUND',body:'Earlier reply'},{direction:'INBOUND',body:'Hi Simpli'}],packet});
  assert.equal(result,packet);
});
