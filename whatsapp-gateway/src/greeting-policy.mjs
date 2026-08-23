const PURE_GREETING_PATTERNS = [
  /^(?:hi|hello|hey|hiya)(?:\s+simpli|\s+there)?[!.?\s]*$/i,
  /^good\s+(?:morning|afternoon|evening)(?:\s+simpli)?[!.?\s]*$/i,
  /^(?:habari|mambo|niaje)(?:\s+simpli)?[!.?\s]*$/i,
];

const FORBIDDEN_GREETING_LEADS = /\b(?:acne|niacinamide|sunscreen|cleanser|moisturi[sz]er|serum|toner|price|stock|routine|product|choose|checking|check the|would you like help with)\b/i;

export function isPureGreeting(text='') {
  const value=String(text||'').trim();
  return PURE_GREETING_PATTERNS.some(pattern=>pattern.test(value));
}

export function canonicalFirstGreeting(text='') {
  const value=String(text||'').trim().toLowerCase();
  if(value.startsWith('good morning')) return "Good morning 😊 I’m Simpli. How are you?";
  if(value.startsWith('good afternoon')) return "Good afternoon 😊 I’m Simpli. How are you?";
  if(value.startsWith('good evening')) return "Good evening 😊 I’m Simpli. How are you?";
  return "Hi 😊 I’m Simpli. How are you?";
}

export function applyGreetingPolicy({text='', messages=[], packet}) {
  if(!packet || !isPureGreeting(text)) return packet;
  const firstReply=!messages.some(message=>message?.direction==='OUTBOUND');
  if(!firstReply) return packet;
  return {
    ...packet,
    primary_intent:'GENERAL_OR_UNCLEAR',
    advisor_action:'ANSWER_DIRECT',
    specialist_route:'NONE',
    control_state:'NONE',
    evidence_state:'NOT_REQUIRED',
    risk_flags:[],
    handoff_required:false,
    questions_needed:[],
    answer_basis:['Greeting-only opening; no customer need has been stated yet.'],
    customer_decision:'UNDECIDED',
    response_text:canonicalFirstGreeting(text),
    outcome:null,
  };
}

export function greetingReplyLooksHuman(text='') {
  const value=String(text||'').trim();
  return /\b(?:i['’]?m|i am)\s+simpli\b/i.test(value)
    && !FORBIDDEN_GREETING_LEADS.test(value)
    && value.length<=120;
}
