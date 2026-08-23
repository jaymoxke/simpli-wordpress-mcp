import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDb} from '../src/db.mjs';
test('sqlite conversation state persists encrypted',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'simpli-wa-')),file=path.join(dir,'db.sqlite'),secret='k'.repeat(40);let db=createDb(file,secret);await db.migrate();const c=await db.getOrCreateConversation({id:'11111111-1111-4111-8111-111111111111',customerRef:'wa_test',externalUserId:'user_1',phone:'+254700000000'});await db.addMessage({conversationId:c.id,providerMessageId:'m1',direction:'INBOUND',type:'text',body:'hello'});db.close();const raw=fs.readFileSync(file);assert.equal(raw.includes(Buffer.from('hello')),false);assert.equal(raw.includes(Buffer.from('+254700000000')),false);db=createDb(file,secret);await db.migrate();const msgs=await db.recentMessages(c.id,5);assert.equal(msgs[0].body,'hello');const reread=await db.getConversation(c.id);assert.equal(reread.phone,'+254700000000');db.close();fs.rmSync(dir,{recursive:true,force:true})});
