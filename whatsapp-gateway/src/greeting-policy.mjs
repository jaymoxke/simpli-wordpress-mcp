const PURE_GREETING_PATTERNS = [
  /^(?:hi|hello|hey|hiya)(?:\s+simpli|\s+there)?[!.?\s]*$/i,
  /^good\s+(?:morning|afternoon|evening)(?:\s+simpli)?[!.?\s]*$/i,
  /^(?:habari|mambo|niaje)(?:\s+simpli)?[!.?\s]*$/i,
];

const FORBIDDEN_GREETING_LEADS = /\b(?:acne|niacinamide|sunscreen|cleanser|moisturi[sz]er|serum|toner|price|stock|routine|product|choose|checking|check the|would you like help with)\b/i;
const SIMPLI_MENTION = /\bsimpli\b/i;
const SIMPLI_SELF_INTRO = /\b(?:i['’]?m|i am)\s+simpli\b/i;
const LEADING_SELF_INTRO = /^(?:(hi|hello|hey|good morning|good afternoon|good evening)\b[,.!\s😊]*)?(?:i['’]?m|i am)\s+simpli\b[,.!:\-–—\s😊]*/i;

export function isPureGreeting(text='') {
  const value=String(text||'').trim();
  return PURE_GREETING_PATTERNS.some(pattern=>pattern.test(value));
}

export function customerAlreadyNamedSimpli(text='') {
  return SIMPLI_MENTION.test(String(text||''));
}

function titleGreeting(value='') {
  const lower=String(value||'').toLowerCase();
  if(lower==='good morning') return 'Good morning';
  if(lower==='good afternoon') return 'Good afternoon';
  if(lower==='good evening') return 'Good evening';
  if(lower==='hello') return 'Hello';
  if(lower==='hey') return 'Hey';
  return 'Hi';
}

export function removeRedundantSelfIntroduction(reply='') {
  const value=String(reply||'').trim();
  const match=value.match(LEADING_SELF_INTRO);
  if(!match) return value;
  const rest=value.slice(match[0].length).trim();
  const greeting=match[1] ? `${titleGreeting(match[1])} 😊` : '';
  if(greeting && rest) return `${greeting} ${rest}`;
  if(greeting) return greeting;
  return rest || 'Hi 😊';
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
  if(!packet) return packet;
  const firstReply=!messages.some(message=>message?.direction==='OUTBOUND');
  if(!firstReply) return packet;
  const alreadyNamed=customerAlreadyNamedSimpli(text);

  if(isPureGreeting(text)) {
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

  if(alreadyNamed && SIMPLI_SELF_INTRO.test(String(packet.response_text||''))) {
    return {
      ...packet,
      response_text:removeRedundantSelfIntroduction(packet.response_text),
      answer_basis:[...(Array.isArray(packet.answer_basis)?packet.answer_basis:[]),'Customer already addressed Simpli by name; redundant self-introduction removed.'],
    };
  }

  return packet;
}

export function greetingReplyLooksHuman(text='', {identityAlreadyKnown=false}={}) {
  const value=String(text||'').trim();
  const identityOkay=identityAlreadyKnown ? !SIMPLI_SELF_INTRO.test(value) : SIMPLI_SELF_INTRO.test(value);
  return identityOkay
    && !FORBIDDEN_GREETING_LEADS.test(value)
    && value.length<=120;
}
