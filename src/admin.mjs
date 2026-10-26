import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError } from './protocol.mjs';
const scrypt=promisify(scryptCallback),hash=s=>createHash('sha256').update(s).digest('hex');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=()=>randomBytes(32).toString('base64url');
export class AdminUI {
  static async create(options){
    const password=options.password;
    if(typeof password!=='string'||password.length<16||password.length>1024)throw Error('admin_password_minimum_16_characters');
    const salt=randomBytes(16),verifier=await scrypt(password,salt,32);
    return new AdminUI({...options,password:undefined,salt,verifier});
  }
  constructor({approval,auth,salt,verifier,reservations=()=>[],publicOrigin,insecureDevelopment=false,sessionMs=28800000}){
    Object.assign(this,{approval,auth,salt,verifier,reservations,insecureDevelopment,sessionMs});
    if(publicOrigin){const u=new URL(publicOrigin);if(u.origin!==publicOrigin||u.username||u.password||u.protocol!==(insecureDevelopment?'http:':'https:'))throw Error('invalid_public_origin');this.publicOrigin=u.origin;}
    this.boot=token();this.loginAttempts=new Map();this.activeLogins=0;
    approval.store.db.exec('DELETE FROM admin_sessions'); // restart requires a fresh login
  }
  get store(){return this.approval.store;}
  origin(req){
    if(this.publicOrigin)return this.publicOrigin;
    const host=req.headers.host;
    if(typeof host!=='string'||!host||/[\s/@\\]/.test(host))throw new ApiError(400,'invalid_request');
    const u=new URL(`${this.insecureDevelopment?'http':'https'}://${host}`);
    if(u.host!==host)throw new ApiError(400,'invalid_request');return u.origin;
  }
  session(req){
    const values=(req.headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('psst_admin='));
    if(values.length!==1)return null;
    const value=values[0].slice('psst_admin='.length);if(!/^[A-Za-z0-9_-]{43}$/.test(value))return null;
    const row=this.store.db.prepare('SELECT * FROM admin_sessions WHERE hash=? AND expires>? AND password_hash=?').get(hash(value),this.store.clock(),this.boot);
    return row?{...row,cookie:value}:null;
  }
  issue(authenticated){
    return this.store.tx(()=>{
      this.store.db.prepare('DELETE FROM admin_sessions WHERE expires<=? OR password_hash<>?').run(this.store.clock(),this.boot);
      if(this.store.db.prepare('SELECT count(*) n FROM admin_sessions').get().n>=1000)throw new ApiError(429,'rate_limited');
      const cookie=token(),csrf=token(),expires=this.store.clock()+(authenticated?this.sessionMs:600000);
      this.store.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?,?)').run(hash(cookie),csrf,authenticated?1:0,expires,this.boot);
      return {cookie,csrf,authenticated,expires,hash:hash(cookie)};
    });
  }
  cookie(session){return `psst_admin=${session?.cookie??''}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${session?Math.max(0,Math.floor((session.expires-this.store.clock())/1000)):0}${this.insecureDevelopment?'':'; Secure'}`;}
  headers(){return {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'same-origin'};}
  html(res,status,content,session){
    res.writeHead(status,{...this.headers(),...(session?{'Set-Cookie':this.cookie(session)}:{})});
    res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Psst administration</title><style>body{font:16px system-ui;max-width:960px;margin:3rem auto;padding:1rem;background:#101820;color:#f3f5f7}input,button{font:inherit;padding:.6rem;margin:.3rem}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:.8rem;border-bottom:1px solid #53616b}form{display:inline}code{overflow-wrap:anywhere}small{color:#b9c8d3}</style><main><h1>Psst</h1>${content}</main></html>`);
  }
  form(action,csrf,text){return `<form method="post" action="${action}"><input type="hidden" name="csrf" value="${csrf}"><button>${text}</button></form>`;}
  async input(req){
    if(req.headers['content-encoding']||!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))throw new ApiError(400,'invalid_request');
    if(Number(req.headers['content-length'])>4096)throw new ApiError(413,'payload_too_large');
    const chunks=[];let size=0;const timer=setTimeout(()=>req.destroy(),10000);timer.unref();
    try{for await(const chunk of req){size+=chunk.length;if(size>4096)throw new ApiError(413,'payload_too_large');chunks.push(chunk);}}finally{clearTimeout(timer);}
    const p=new URLSearchParams(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))),result={};
    for(const[k,v]of p){if(Object.hasOwn(result,k))throw new ApiError(400,'invalid_request');result[k]=v;}return result;
  }
  loginRate(req){
    const now=this.store.clock(),key=req.socket.remoteAddress??'unknown';
    for(const[k,v]of this.loginAttempts)if(now-v.at>=60000)this.loginAttempts.delete(k);
    if(!this.loginAttempts.has(key)&&this.loginAttempts.size>=1000)throw new ApiError(429,'rate_limited',null,{retry_after:60});
    const value=this.loginAttempts.get(key)??{at:now,count:0};value.count++;this.loginAttempts.set(key,value);
    if(value.count>5||this.loginAttempts.size>1000||this.activeLogins>=2)throw new ApiError(429,'rate_limited',null,{retry_after:60});
  }
  redirect(res,session){res.writeHead(303,{...this.headers(),Location:'/admin','Set-Cookie':this.cookie(session)});res.end();}
  async handle(req,res,url){
    if(!url.pathname.startsWith('/admin'))return false;
    let page=0;
    if(url.search){
      if(req.method!=='GET'||url.pathname!=='/admin'||[...url.searchParams.keys()].some(k=>k!=='page')||url.searchParams.getAll('page').length!==1||!/^(0|[1-9][0-9]?)$/.test(url.searchParams.get('page')))throw new ApiError(400,'invalid_request');
      page=Number(url.searchParams.get('page'));
    }
    const session=this.session(req);
    if(req.method==='GET'&&url.pathname==='/admin'){
      if(!session?.authenticated){const fresh=session??this.issue(false);this.html(res,200,`<h2>Administrator login</h2><form method="post" action="/admin/login"><input type="hidden" name="csrf" value="${fresh.csrf}"><label>Password <input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label><button>Log in</button></form>`,fresh);return true;}
      const entries=this.approval.list({offset:page*100,limit:100});
      const rows=entries.map(row=>{
        const actions=row.state==='pending'?['approve','deny']:row.state==='approved'?['revoke']:[];
        const c=row.result?JSON.parse(row.result):null;
        return `<tr data-request-id="${row.id}"><td><strong>${escape(row.label)}</strong><br><small>${escape(row.type)}</small><br><code>${row.id}</code></td><td>${escape(row.state)}${c?`<br><small>Credential ${escape(c.credential_id)}<br>Expires ${escape(c.expires_at)}</small>`:''}</td><td>${actions.map(a=>this.form(`/admin/requests/${row.id}/${a}`,session.csrf,a)).join('')}</td></tr>`;
      }).join('');
      this.html(res,200,`<h2>Installation access</h2><p>Approve only installations you recognize. Names are untrusted labels. Approval does not revoke older installations; revoke them explicitly when appropriate.</p>${this.form('/admin/logout',session.csrf,'Log out')} <a href="/admin">Refresh requests</a><p>Page ${page+1}. ${page?`<a href="/admin?page=${page-1}">Previous</a>`:''} ${entries.length===100&&page<99?`<a href="/admin?page=${page+1}">Next</a>`:''}</p><table><thead><tr><th>Request</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`,session);return true;
    }
    if(req.method!=='POST')throw new ApiError(404,'invalid_request');
    // Origin and session are checked before accepting a password/form upload.
    if(req.headers.origin!==this.origin(req)||!session)throw new ApiError(403,'forbidden');
    if(url.pathname==='/admin/login')this.loginRate(req);
    else if(!session.authenticated)throw new ApiError(401,'unauthenticated');
    const input=await this.input(req);
    if(!this.session(req))throw new ApiError(401,'unauthenticated');
    if(typeof input.csrf!=='string'||input.csrf!==session.csrf)throw new ApiError(403,'forbidden');
    if(url.pathname==='/admin/login'){
      if(Object.keys(input).some(k=>!['csrf','password'].includes(k))||typeof input.password!=='string'||input.password.length>1024)throw new ApiError(400,'invalid_request');
      if(this.activeLogins>=2)throw new ApiError(429,'rate_limited',null,{retry_after:60});
      this.activeLogins++;let valid;
      try{valid=timingSafeEqual(await scrypt(input.password,this.salt,32),this.verifier);}finally{this.activeLogins--;}
      if(!this.session(req))throw new ApiError(401,'unauthenticated');
      if(!valid){this.html(res,401,`<h2>Administrator login</h2><p role="alert">Password not accepted. Try again.</p><form method="post" action="/admin/login"><input type="hidden" name="csrf" value="${session.csrf}"><label>Password <input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label><button>Log in</button></form>`,session);return true;}
      this.store.tx(()=>this.store.db.prepare('DELETE FROM admin_sessions WHERE hash=?').run(session.hash));
      this.redirect(res,this.issue(true));return true;
    }
    if(Object.keys(input).some(k=>k!=='csrf'))throw new ApiError(400,'invalid_request');
    if(url.pathname==='/admin/logout'){
      this.store.tx(()=>this.store.db.prepare('DELETE FROM admin_sessions WHERE hash=?').run(session.hash));this.redirect(res,null);return true;
    }
    const action=/^\/admin\/requests\/([^/]+)\/(approve|deny|revoke)$/.exec(url.pathname);
    if(!action)throw new ApiError(404,'invalid_request');
    this.auth.reload();this.approval.decide(action[1],action[2],[...this.auth.configuredEntries,...this.reservations()]);this.auth.reload();
    this.redirect(res,session);return true;
  }
}
