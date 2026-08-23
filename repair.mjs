import http from 'node:http';

const { WORDPRESS_URL, WORDPRESS_USERNAME, WORDPRESS_APP_PASSWORD, REPAIR_TOKEN, PORT='3000' } = process.env;
if (!WORDPRESS_URL || !WORDPRESS_USERNAME || !WORDPRESS_APP_PASSWORD || !REPAIR_TOKEN) throw new Error('repair env incomplete');
const auth='Basic '+Buffer.from(`${WORDPRESS_USERNAME}:${WORDPRESS_APP_PASSWORD}`,'utf8').toString('base64');
const base=WORDPRESS_URL.replace(/\/$/,'');
function send(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body),'cache-control':'no-store'});res.end(body)}
function authorized(req){return req.headers.authorization===`Bearer ${REPAIR_TOKEN}`}
async function wp(path,options={}){const r=await fetch(base+path,{...options,headers:{Authorization:auth,Accept:'application/json','Content-Type':'application/json',...(options.headers||{})},redirect:'error',signal:AbortSignal.timeout(20000)});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,ok:r.ok,data}}
const server=http.createServer(async(req,res)=>{try{
 if(req.url==='/health')return send(res,200,{ok:true,service:'simpli-mcp-emergency-repair',mode:'PROBE_ONLY'});
 if(!authorized(req))return send(res,401,{error:'unauthorized'});
 if(req.method==='GET'&&req.url==='/probe'){
  const found=[];
  for(let page=1;page<=5;page++){
   const r=await wp(`/wp-json/wp-abilities/v1/abilities?page=${page}&per_page=100`);
   if(!r.ok)return send(res,502,{stage:'list',status:r.status,data:r.data});
   if(!Array.isArray(r.data))return send(res,502,{stage:'list',error:'not_array'});
   for(const a of r.data){if(String(a?.name||'').includes('execute-php')||String(a?.name||'').includes('file'))found.push({name:a.name,input_schema:a.input_schema,meta:a.meta,_links:a._links});}
   if(r.data.length<100)break;
  }
  return send(res,200,{found});
 }
 return send(res,404,{error:'not_found'});
}catch(e){return send(res,500,{error:String(e?.message||e)})}});
server.listen(Number(PORT),'0.0.0.0');
