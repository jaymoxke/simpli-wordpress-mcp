const PURE_GREETING_PATTERNS = [
  /^(?:hi|hello|hey|hiya)(?:\s+simpli|\s+there)?[!.?\s]*$/i,
  /^good\s+(?:morning|afternoon|evening)(?:\s+simpli)?[!.?\s]*$/i,
  /^(?:habari|mambo|niaje)(?:\s+simpli)?[!.?\s]*$/i,
];

const FORBIDDEN_GREETING_LEADS = /\b(?:acne|niacinamide|sunscreen|cleanser|moisturi[sz]er|serum|toner|price|stock|routine|product|choose|checking|check the|would you like help with)\b/i;
const SIMPLI_MENTION = /\bsimpli\b/i;
const SIMPLI_SELF_INTRO = /\b(?:i['’]?m|i am)\s+simpli\b/i;

export function isPureGreeting(text='') {
  const value=String(text||'').trim();
  return PURE_GREETING_PATTERNS.some(pattern=>pattern.test(value));
}

export function customerAlreadyNamedSimpli(text='') {
  return SIMPLI_MENTION.test(String(text||''));
}

export function canonicalFirstGreeting(text='') {
  const raw=String(text||'').trim();
  const value=raw.toLowerCase();
  const alreadyNamed=customerAlreadyNamedSimpli(raw);
  const identity=alreadyNamed ? '' : ' I’m Simpli.';
  if(value.startsWith('good morning')) return `Good morning 😊${identity} How are you?`;
  if(value.startsWith('good afternoon')) return `Good afternoon 😊${identity} How are you?`;
  if(value.startsWith('good evening')) return `Good evening 😊${identity} How are you?`;
  return `Hi 😊${identity} How are you?`;
}

export function applyGreetingPolicy({text='', messages=[], packet}) {
  if(!packet || !isPureGreeting(text)) return packet;
  const firstReply=!messages.some(message=>message?.direction==='OUTBOUND');
  if(!firstReply) return packet;
  const alreadyNamed=customerAlreadyNamedSimpli(text);
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
    answer_basis:[alreadyNamed
      ? 'Greeting-only opening; customer already addressed Simpli by name, so do not repeat the introduction.'
      : 'Greeting-only opening; introduce Simpli once because the customer has not used the assistant name yet.'],
    customer_decision:'UNDECIDED',
    response_text:canonicalFirstGreeting(text),
    outcome:null,
  };
}

export function greetingReplyLooksHuman(text='', {identityAlreadyKnown=false}={}) {
  const value=String(text||'').trim();
  const identityOkay=identityAlreadyKnown ? !SIMPLI_SELF_INTRO.test(value) : SIMPLI_SELF_INTRO.test(value);
  return identityOkay
    && !FORBIDDEN_GREETING_LEADS.test(value)
    && value.length<=120;
}
