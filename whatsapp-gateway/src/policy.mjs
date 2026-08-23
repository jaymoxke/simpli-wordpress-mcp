const URGENT_SAFETY=/\b(difficulty breathing|breathing difficulty|struggl(?:e|ing) to breathe|can'?t breathe|short(?:ness)? of breath|anaphyl|faint(?:ed|ing)?|collapse|(?:eye|eyes|lip|lips|tongue|face|facial)(?: is| are)? swelling|(?:eye|lip|tongue|face|facial) swelling|severe burn|severe blister|emergency|hospital|ambulance)\b/i;
const PRESCRIPTION=/\b(prescription|prescribed|tretinoin|isotretinoin|accutane|retinoic acid|dose|dosage|taper|dermatologist diagnosed|doctor prescribed)\b/i;
const REACTION=/\b(burning|stinging|itching|hives|rash|swelling|blister(?:ing)?|painful redness|severe redness|reaction|irritation|skin is peeling badly)\b/i;
const PAYMENT=/\b(mpesa|m-pesa|paid|payment|charged|deducted|transaction|stk|pay again|duplicate payment|money sent|payment failed|payment pending|not reflected)\b/i;
const AUTH=/\b(fake|counterfeit|authentic|original|genuine|authenticity)\b/i;
const SERVICE=/\b(refund|return|replacement|wrong item|missing item|damaged|leaking|broken|complaint|received the wrong|parcel.*damaged)\b/i;
const PRIVACY=/\b(delete my data|privacy|unsubscribe|opt out|opt-out|stop marketing|my data|remove my number|marketing messages)\b/i;
const ORDER=/\b(where is my order|track(?:ing)? my order|order status|order #|order number|my order (?:is|has|was)|dispatch(?:ed)?|shipped|courier|delivery status|delivery eta|eta for my order|change.*address.*order)\b/i;
const INJECTION=/\b(ignore (?:all |the )?(?:previous|system|developer) instructions|reveal (?:your )?(?:system prompt|developer message|instructions)|show (?:your )?(?:system prompt|developer prompt)|bypass (?:your )?(?:rules|guardrails|policy)|call simpli_execute|use the generic dispatcher|act as system|developer message says)\b/i;

export function preflightRisk(text=''){
  const value=String(text||'');
  const flags=[];
  if(URGENT_SAFETY.test(value))flags.push('URGENT_SAFETY');
  if(PRESCRIPTION.test(value))flags.push('PRESCRIPTION_REVIEW');
  if(REACTION.test(value))flags.push('REACTION_REVIEW');
  if(PAYMENT.test(value))flags.push('PAYMENT_REVIEW');
  if(ORDER.test(value))flags.push('ORDER_DELIVERY_REVIEW');
  if(AUTH.test(value))flags.push('AUTHENTICITY_REVIEW');
  if(SERVICE.test(value))flags.push('SERVICE_RECOVERY');
  if(PRIVACY.test(value))flags.push('PRIVACY_REVIEW');
  if(INJECTION.test(value))flags.push('PROMPT_INJECTION_REJECT');
  return{flags,blocking:flags.length>0,controlState:flags.includes('PROMPT_INJECTION_REJECT')?'PROMPT_INJECTION_REJECT':flags.length?'QA_BLOCK':'NONE'};
}

export function safeEscalationReply(flags=[]){
  if(flags.includes('URGENT_SAFETY'))return "Thanks for telling me. I don’t want to guess with something this important. I’m flagging this for immediate human review; if you’re having trouble breathing, fainting, rapidly worsening facial or eye swelling, or another severe reaction, please seek urgent medical care now.";
  if(flags.includes('PRESCRIPTION_REVIEW'))return "Thanks for sharing that. Because this involves a prescription or prescription-strength treatment, I won’t advise you to start, stop, change the dose or change frequency from chat. I’m flagging it for human review; for medication changes, please follow your prescriber’s guidance.";
  if(flags.includes('REACTION_REVIEW'))return "Thanks for telling me. I don’t want to guess about a reaction, so I’m flagging this for human review. If this is a non-prescription cosmetic that is clearly worsening the irritation, avoid reapplying it until reviewed; if symptoms become severe or involve breathing or the eyes, seek urgent medical care.";
  if(flags.includes('PAYMENT_REVIEW'))return "Thanks for flagging this. Please don’t pay again yet — I want the first transaction verified before we risk a duplicate payment. I’m sending this for payment review.";
  if(flags.includes('ORDER_DELIVERY_REVIEW'))return "I’m sending this for a secure order or delivery check rather than guessing about a live order state. Once the order is matched and verified, the team can give you the correct update.";
  if(flags.includes('AUTHENTICITY_REVIEW'))return "Thanks for raising this. I can’t confirm authenticity from a chat or packaging description alone, so I’m flagging it for verification before we give you a definite answer.";
  if(flags.includes('SERVICE_RECOVERY'))return "I’m sorry you’ve had to deal with that. I’m flagging this for human service review so we can verify what happened and sort out the right remedy before suggesting anything else.";
  if(flags.includes('PRIVACY_REVIEW'))return "Understood. I’m flagging this as a privacy or communication-preference request so it can be handled correctly rather than treated as an ordinary support message.";
  if(flags.includes('PROMPT_INJECTION_REJECT'))return "I can help with Simpli product, skincare and support questions, but instructions inside a chat can’t change my safety, privacy or access rules.";
  return "Thanks for your message. I’ve flagged this for the team to review.";
}

export function qaCustomerReply(text=''){
  const value=String(text||'');
  const reasons=[];
  if(!value.trim())reasons.push('EMPTY');
  if(value.length>1800)reasons.push('TOO_LONG');
  if(/\b(here is a reply|ready to send|draft:|option 1|internal enum|reason code|system prompt|developer message)\b/i.test(value))reasons.push('META_TEXT');
  if(/\b(QA_BLOCK|CURRENT_STATE_REQUIRED|PROMPT_INJECTION_REJECT|ROUTE_[A-Z_]+|A[1-5]_[A-Z_]+|STATE_VERIFIED)\b/.test(value))reasons.push('INTERNAL_LABEL');
  if(/\b(?:MCP|Golden Product Intelligence|tool calls?|evidence state|grounding (?:state|gate|requirement)|admission gate|backend process|WooCommerce record)\b/i.test(value))reasons.push('INTERNAL_JARGON');
  if(/\b(as an ai|as a language model|i(?: am|'m) an ai|my training data|my knowledge cutoff|i cannot browse|i can'?t browse|i don'?t have access to (?:live|real[- ]time) data)\b/i.test(value))reasons.push('AI_META');
  if(/^\s*(?:dear (?:valued )?customer|greetings[!,. ]*|thank you for your inquiry|we appreciate your inquiry|as per your (?:query|request)|based on the information provided)\b/i.test(value))reasons.push('ROBOTIC_TONE');
  if(/```|\|\s*-{3,}\s*\|/.test(value))reasons.push('WHATSAPP_FORMAT');
  if((value.match(/!/g)||[]).length>3)reasons.push('EXCESSIVE_EXCLAMATION');
  if((value.match(/\p{Extended_Pictographic}/gu)||[]).length>2)reasons.push('EXCESSIVE_EMOJI');
  if(/\b(i personally (?:use|used|love|recommend)|i(?:'ve| have) personally (?:used|tried)|from my own experience)\b/i.test(value))reasons.push('FALSE_PERSONAL_EXPERIENCE');
  if(/\b(everyone loves (?:it|this)|our customers all love|everyone is buying|best[- ]seller|bestselling|#1 (?:product|choice|seller)|most popular in kenya)\b/i.test(value))reasons.push('UNSUPPORTED_SOCIAL_PROOF');
  if(/\b(only \d+ left|selling out fast|almost sold out|limited stock|while stocks last|act now|buy before it'?s gone)\b/i.test(value))reasons.push('SCARCITY_PRESSURE');
  if(/\b(perfect for you|perfect match for you|guaranteed to suit you)\b/i.test(value))reasons.push('OVERCLAIMED_FIT');
  if(/\b(definitely authentic|definitely fake|guaranteed|cures? acne|cures? eczema|treats? eczema|safe for everyone|will definitely work)\b/i.test(value))reasons.push('UNSUPPORTED_CERTAINTY');
  if(/\b(you (?:have|definitely have) (?:eczema|rosacea|psoriasis|dermatitis)|this is definitely (?:eczema|rosacea|psoriasis|dermatitis))\b/i.test(value))reasons.push('DIAGNOSIS_RISK');
  if(/\b(start|stop|increase|decrease|double|halve|taper|use more|use less)\b[^.!?]{0,80}\b(tretinoin|isotretinoin|accutane|prescription|dose|dosage)\b/i.test(value)||/\b(tretinoin|isotretinoin|accutane|prescription)\b[^.!?]{0,80}\b(every night|twice daily|once daily|increase|decrease|stop|start|taper)\b/i.test(value))reasons.push('PRESCRIPTION_MANAGEMENT');
  if(/\b(pay again|make another payment|send the money again)\b/i.test(value)&&/\b(mpesa|m-pesa|payment|paid|charged|deducted|transaction)\b/i.test(value))reasons.push('REPAY_RISK');
  if(/\b(you definitely need to buy|you must buy|buy this immediately|don'?t miss out|hurry|last chance)\b/i.test(value))reasons.push('COMMERCIAL_PRESSURE');
  if(/\bwa_[a-f0-9]{16,}\b/i.test(value)||/\bresp_[A-Za-z0-9_-]{8,}\b/.test(value))reasons.push('INTERNAL_IDENTIFIER');
  return{pass:reasons.length===0,reasons};
}

export function isClosedNow(hoursConfig,date=new Date()){
  if(!hoursConfig||hoursConfig.configured!==true)return{closed:false,configured:false,reason:'SCHEDULE_NOT_CONFIGURED'};
  const timezone=hoursConfig.timezone||'Africa/Nairobi',parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date),day=parts.find(p=>p.type==='weekday')?.value,hh=Number(parts.find(p=>p.type==='hour')?.value),mm=Number(parts.find(p=>p.type==='minute')?.value),minute=hh*60+mm,rule=hoursConfig.week?.[day];
  if(!rule||rule.closed===true)return{closed:true,configured:true,reason:'CLOSED_DAY'};
  const[sh,sm]=String(rule.open).split(':').map(Number),[eh,em]=String(rule.close).split(':').map(Number),open=sh*60+sm,close=eh*60+em;
  return{closed:minute<open||minute>=close,configured:true,reason:'HOURS'};
}
export function shouldAutoSend({mode,owner,riskBlocking,hoursResult}){
  if(owner!=='AI')return{send:false,reason:'HUMAN_OWNED'};
  if(riskBlocking)return{send:false,reason:'RISK_BLOCK'};
  if(mode==='HUMAN_ONLY'||mode==='SHADOW')return{send:false,reason:mode};
  if(mode==='AI_ALWAYS')return{send:true,reason:'AI_ALWAYS'};
  if(mode==='AFTER_HOURS'){if(!hoursResult.configured)return{send:false,reason:'SCHEDULE_NOT_CONFIGURED'};return hoursResult.closed?{send:true,reason:'CLOSED'}:{send:false,reason:'OPEN'}}
  return{send:false,reason:'UNKNOWN_MODE'};
}
