import test from 'node:test';
import assert from 'node:assert/strict';
import {applyGreetingPolicy, canonicalFirstGreeting, greetingReplyLooksHuman, isPureGreeting} from '../src/greeting-policy.mjs';

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

test('first greeting is social, brief and contains no unsolicited shopping menu',()=>{
  const result=applyGreetingPolicy({text:'Hi Simpli',messages:[{direction:'INBOUND',body:'Hi Simpli'}],packet});
  assert.equal(result.response_text,"Hi 😊 I’m Simpli. How are you?");
  assert.equal(result.primary_intent,'GENERAL_OR_UNCLEAR');
  assert.equal(result.advisor_action,'ANSWER_DIRECT');
  assert.equal(result.customer_decision,'UNDECIDED');
  assert.equal(greetingReplyLooksHuman(result.response_text),true);
  assert.doesNotMatch(result.response_text,/acne|Anua|niacinamide|price|product|routine|choose/i);
});

test('time-of-day greeting stays natural',()=>{
  assert.equal(canonicalFirstGreeting('Good morning Simpli!'),"Good morning 😊 I’m Simpli. How are you?");
});

test('continuation greeting is not overwritten',()=>{
  const result=applyGreetingPolicy({text:'Hi Simpli',messages:[{direction:'OUTBOUND',body:'Earlier reply'},{direction:'INBOUND',body:'Hi Simpli'}],packet});
  assert.equal(result,packet);
});
