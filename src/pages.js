const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BASE_CSS = `
:root{--bg:#0e0f13;--panel:#171922;--line:#2a2d3a;--text:#eceef5;--mute:#9aa0b4;--accent:#7c5cff;--ok:#2fcf8a;--bad:#ff5d6c;--warn:#f5b84b}
@media (prefers-color-scheme: light){:root{--bg:#f6f6f9;--panel:#fff;--line:#dcdde6;--text:#14151c;--mute:#5d6377}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:var(--accent)}h1,h2,h3{line-height:1.2}
`;

const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${BASE_CSS}
.wrap{max-width:720px;margin:0 auto;padding:32px 16px}</style></head><body><div class="wrap">${body}</div></body></html>`;

export const homeHtml = (env = {}) => shell(env.BRAND_NAME || 'DM bot', `<h1>${esc(env.BRAND_NAME || 'DM bot')}</h1><p>This address runs an Instagram messaging assistant.</p><p><a href="/privacy">Privacy policy</a> · <a href="/data-deletion">Data deletion</a></p>`);

export const privacyHtml = (env) => shell('Privacy Policy', `
<h1>Privacy Policy</h1><p>Last updated November 24, 2026.</p>
<p>${esc(env.BRAND_NAME || 'The account owner')} operates an Instagram messaging assistant for the account @${esc(env.IG_USERNAME || 'your_handle')}. It sends a guide or link to people who ask for it by commenting a keyword on a post or messaging a keyword to the account.</p>
<h2>What we collect</h2>
<ul><li>Your Instagram-scoped user ID and public username.</li>
<li>The text of your comment or message that contained the keyword, and your replies to our questions.</li>
<li>Whether you opened the link we sent.</li></ul>
<h2>Why</h2><p>To deliver what you asked for, to follow up once if you do not reply, and so the account owner can reply to you personally.</p>
<h2>Who sees it</h2><p>Only the account owner. We do not sell your data and do not share it with advertisers.</p>
<h2>How long we keep it</h2><p>Until you ask us to delete it.</p>
<h2>Your choices</h2><p>To see or delete your data, follow the steps on the <a href="/data-deletion">data deletion page</a>, or email <a href="mailto:${esc(env.CONTACT_EMAIL || 'you@example.com')}">${esc(env.CONTACT_EMAIL || 'you@example.com')}</a>.</p>`);

export const deletionHtml = (env) => shell('Data Deletion', `
<h1>Delete your data</h1>
<p>To have everything we hold about you removed:</p>
<ol><li>Email <a href="mailto:${esc(env.CONTACT_EMAIL || 'you@example.com')}">${esc(env.CONTACT_EMAIL || 'you@example.com')}</a> from any address, or send a message to @${esc(env.IG_USERNAME || 'your_handle')} on Instagram that says "delete my data".</li>
<li>Include your Instagram username.</li>
<li>We delete your username, user ID, messages, answers and click record within 30 days, and confirm when it is done.</li></ol>
<p>You can also remove the connection on Instagram under Settings, Apps and websites.</p>`);

export const loginHtml = (msg, configured) => shell('Sign in · DM bot', `
<h1>DM bot</h1>
${configured ? '' : '<p style="color:var(--warn)">No admin password is set yet. Run <code>npx wrangler secret put ADMIN_PASSWORD</code>, then reload.</p>'}
${msg ? `<p style="color:var(--bad)">${esc(msg)}</p>` : ''}
<form method="post" action="/admin/login"><p><input type="password" name="password" placeholder="Password" autofocus required
style="padding:10px;width:100%;max-width:320px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text)"></p>
<button style="padding:10px 18px;border-radius:8px;border:0;background:var(--accent);color:#fff;font-weight:600;cursor:pointer">Sign in</button></form>`);

export const adminHtml = () => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>DM bot</title><style>${BASE_CSS}
header{display:flex;gap:12px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
header h1{font-size:18px;margin:0;flex:1}
.pill{padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700;border:1px solid var(--line)}
.pill.dry{color:var(--warn);border-color:var(--warn)}.pill.live{color:var(--ok);border-color:var(--ok)}.pill.off{color:var(--mute)}
nav{display:flex;gap:4px;padding:0 20px;border-bottom:1px solid var(--line)}
nav button{background:none;border:0;color:var(--mute);padding:12px 14px;font:inherit;cursor:pointer;border-bottom:2px solid transparent}
nav button.on{color:var(--text);border-color:var(--accent)}
main{padding:20px;max-width:1100px;margin:0 auto}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.grow{flex:1}
button.b{padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text);cursor:pointer;font:inherit}
button.b.pri{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
button.b.bad{color:var(--bad)}
.funnel{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.funnel div{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 12px;min-width:84px}
.funnel b{display:block;font-size:20px}.funnel span{font-size:12px;color:var(--mute)}
label{display:block;font-size:13px;color:var(--mute);margin:12px 0 4px}
input[type=text],input[type=number],textarea,select{width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--text);font:inherit}
textarea{min-height:80px;resize:vertical}
.cols{display:grid;grid-template-columns:1fr 340px;gap:20px}
@media(max-width:860px){.cols{grid-template-columns:1fr}}
.phone{position:sticky;top:12px;background:#000;border-radius:28px;padding:14px;border:1px solid var(--line)}
.phone .screen{background:#111;border-radius:18px;padding:12px;min-height:420px;display:flex;flex-direction:column;gap:8px}
.bub{max-width:88%;padding:8px 12px;border-radius:18px;font-size:14px;white-space:pre-wrap;word-break:break-word}
.bub.me{align-self:flex-end;background:#3b82f6;color:#fff}.bub.bot{align-self:flex-start;background:#2b2b2e;color:#f1f1f3}
.bub.note{align-self:center;background:none;color:#888;font-size:11px}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{border:1px solid #555;color:#ddd;padding:4px 10px;border-radius:99px;font-size:13px}
.btnrow{margin-top:6px;border-top:1px solid #444;padding-top:6px;text-align:center;color:#6ab0ff;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word}
th{color:var(--mute);font-weight:600}
.s-error{color:var(--bad)}.s-sent{color:var(--ok)}.s-dry{color:var(--warn)}
.hint{font-size:12px;color:var(--mute);margin-top:4px}code{background:var(--bg);padding:1px 6px;border-radius:5px}
#toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--line);padding:10px 16px;border-radius:10px;display:none}
</style></head><body>
<header><h1>DM bot</h1><span id="mode" class="pill"></span><a href="/admin/logout">Sign out</a></header>
<nav id="tabs"></nav><main id="main"></main><div id="toast"></div>
<script>
(function(){
var S={tab:'automations',state:null,editing:null,media:[],contacts:[],log:[],acct:''};
function handleOf(id){var x=(S.state.accounts||[]).filter(function(a){return a.id===id})[0];return x?'@'+x.handle:''}
var $=function(s,p){return (p||document).querySelector(s)};
function h(tag,attrs){var e=document.createElement(tag);for(var k in (attrs||{})){var v=attrs[k];if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.indexOf('on')===0)e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?'':v)}
for(var i=2;i<arguments.length;i++){var c=arguments[i];if(c==null||c===false)continue;e.appendChild(typeof c==='string'?document.createTextNode(c):c)}return e}
function toast(m){var t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(function(){t.style.display='none'},3200)}
function api(path,method,body){return fetch('/admin/api/'+path,{method:method||'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Error');return j})})}
function load(){return api('state').then(function(s){S.state=s;render()}).catch(function(e){if(/signed in/i.test(e.message))location.reload();else toast(e.message)})}
function when(t){return t?new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''}

function renderTabs(){var t=$('#tabs');t.textContent='';[['automations','Automations'],['contacts','Contacts'],['log','Log'],['setup','Setup and test']].forEach(function(x){
t.appendChild(h('button',{class:S.tab===x[0]?'on':'',text:x[1],onclick:function(){S.tab=x[0];S.editing=null;if(x[0]==='contacts')api('contacts').then(function(r){S.contacts=r.contacts;render()});else if(x[0]==='log')api('log').then(function(r){S.log=r.log;render()});else render()}}))})}

function render(){var m=S.state.mode;var p=$('#mode');p.textContent=m.dryRun?'DRY RUN, sends nothing':'LIVE';p.className='pill '+(m.dryRun?'dry':'live');renderTabs();var main=$('#main');main.textContent='';
if(S.tab==='automations')main.appendChild(S.editing?editor():list());else if(S.tab==='contacts')main.appendChild(contacts());else if(S.tab==='log')main.appendChild(logView());else main.appendChild(setup())}

function funnel(st){var box=h('div',{class:'funnel'});[['Started',st.started],['DM opened',st.opened],['Answered',st.answered],['Delivered',st.delivered],['Clicked',st.clicked],['Failed',st.failed]].forEach(function(x){box.appendChild(h('div',null,h('b',{text:String(x[1]||0)}),h('span',{text:x[0]})))});return box}

function list(){var w=h('div');var accts=S.state.accounts||[];
var filt=h('select',{style:'width:auto'});filt.appendChild(h('option',{value:'',text:'All accounts'}));accts.forEach(function(x){filt.appendChild(h('option',{value:x.id,text:'@'+x.handle}))});filt.value=S.acct;filt.addEventListener('change',function(){S.acct=filt.value;render()});
w.appendChild(h('div',{class:'row',style:'margin-bottom:14px'},h('h2',{class:'grow',style:'margin:0',text:'Automations'}),accts.length>1?filt:null,h('button',{class:'b pri',text:'New automation',onclick:function(){S.editing=blank();loadMedia();render()}})));
var shown=S.state.automations.filter(function(a){return !S.acct||a.account_id===S.acct});
if(!shown.length)w.appendChild(h('div',{class:'card',text:'No automations yet. Make one: pick a reel, type the keyword, write the messages, paste the guide link, press Go live.'}));
shown.forEach(function(a){var trig=[];if(a.match_comment)trig.push('comment on '+(a.media_id==='*'?'any post':(a.media_label||a.media_id||'?')));if(a.match_dm)trig.push('DM');
w.appendChild(h('div',{class:'card'},h('div',{class:'row'},h('b',{class:'grow',text:a.name}),accts.length>1?h('span',{class:'pill off',text:handleOf(a.account_id)}):null,h('span',{class:'pill '+(a.status==='live'?'live':'off'),text:a.status==='live'?'LIVE':'OFF'}),
h('button',{class:'b',text:'Edit',onclick:function(){S.editing=Object.assign({},a);loadMedia();render()}}),
h('button',{class:'b '+(a.status==='live'?'':'pri'),text:a.status==='live'?'Pause':'Go live',onclick:function(){api('automation/'+a.id+'/status','POST',{status:a.status==='live'?'off':'live'}).then(function(){toast(a.status==='live'?'Paused':'Live');load()}).catch(function(e){toast(e.message)})}}),
h('button',{class:'b bad',text:'Delete',onclick:function(){if(confirm('Delete "'+a.name+'" and its contact history?'))api('automation/'+a.id,'DELETE').then(load)}})),
h('div',{class:'hint',text:'Keywords: '+a.keywords.join(', ')+'  |  Triggers: '+(trig.join(' + ')||'none')}),funnel(a.stats)))});return w}

function blank(){return {account_id:S.acct||((S.state.accounts||[])[0]||{}).id||'',name:'',keywords:[],match_comment:1,match_dm:1,media_id:'',comment_replies:['Just sent you a DM, answer it and the guide is yours.','Sent! Check your DMs and answer the question.'],opener_text:'Happy to send it. Quick question first so I point you at the right part: what kind of business do you run?',opener_buttons:[],delivery_text:'Here it is. Which part do you want to start with?',link_url:'',link_label:'Open the guide',require_follow:0,follow_text:'',fallback_text:'',fallback_minutes:60}}
function loadMedia(){S.media=[];if(S.state.mode.dryRun&&!S.state.mode.hasToken)return;api('media?account='+encodeURIComponent((S.editing&&S.editing.account_id)||'')).then(function(r){S.media=r.media;render()}).catch(function(){})}

function editor(){var a=S.editing;var w=h('div',{class:'cols'});var f=h('div');
function field(label,key,type,hint){var el=type==='area'?h('textarea'):h('input',{type:type==='number'?'number':'text'});var v=a[key];el.value=Array.isArray(v)?v.join(type==='area'?'\\n':', '):(v==null?'':v);el.addEventListener('input',function(){a[key]=(key==='keywords')?el.value.split(',').map(function(s){return s.trim()}).filter(Boolean):(['comment_replies','opener_buttons'].indexOf(key)>=0?el.value.split('\\n').map(function(s){return s.trim()}).filter(Boolean):el.value);preview()});return h('div',null,h('label',{text:label}),el,hint?h('div',{class:'hint',text:hint}):null)}
function check(label,key){var el=h('input',{type:'checkbox'});el.checked=!!a[key];el.addEventListener('change',function(){a[key]=el.checked?1:0;preview()});return h('label',{style:'display:flex;gap:8px;align-items:center;color:var(--text)'},el,label)}
f.appendChild(h('div',{class:'card'},h('h3',{text:'1. When it fires'}),
(function(){var sel=h('select');(S.state.accounts||[]).forEach(function(x){sel.appendChild(h('option',{value:x.id,text:'@'+x.handle+(x.label?' ('+x.label+')':'')}))});sel.value=a.account_id||'';
sel.addEventListener('change',function(){a.account_id=sel.value;a.media_id='';a.media_label='';loadMedia();render()});return h('div',null,h('label',{text:'Instagram account'}),sel,h('div',{class:'hint',text:'Replies are sent from this account, and only its DMs and comments trigger this.'}))})(),
field('Name','name','text'),field('Keywords, comma separated','keywords','text','Any case, extra words fine. "BUILD", "build!!" and "I want the build list" all match.'),
(function(){var sel=h('select');sel.appendChild(h('option',{value:'',text:'Pick a reel...'}));sel.appendChild(h('option',{value:'*',text:'Any post'}));S.media.forEach(function(m){sel.appendChild(h('option',{value:m.id,text:(m.type||'')+' | '+m.label}))});
if(a.media_id&&a.media_id!=='*'&&!S.media.some(function(m){return m.id===a.media_id}))sel.appendChild(h('option',{value:a.media_id,text:a.media_label||a.media_id}));sel.value=a.media_id||'';
sel.addEventListener('change',function(){a.media_id=sel.value;var m=S.media.filter(function(x){return x.id===sel.value})[0];a.media_label=sel.value==='*'?'Any post':(m?m.label:a.media_label)});
var manual=h('input',{type:'text',placeholder:'or paste a media ID'});manual.addEventListener('change',function(){if(manual.value.trim()){a.media_id=manual.value.trim();a.media_label=a.media_id;render()}});
return h('div',null,h('label',{text:'Reel for comment trigger'}),sel,h('div',{style:'margin-top:6px'},manual))})(),
h('div',{style:'margin-top:10px'},check('Comment on the reel','match_comment'),check('DM containing the keyword','match_dm')),
field('Public replies under the comment, one per line (it rotates)','comment_replies','area')));
f.appendChild(h('div',{class:'card'},h('h3',{text:'2. The question'}),field('Opening message (a question about their business)','opener_text','area','Leave empty to send the guide straight away.'),field('Tap answers, one per line (optional, max 13, 20 characters each)','opener_buttons','area','Typed answers work too and are saved.')));
f.appendChild(h('div',{class:'card'},h('h3',{text:'3. The guide'}),field('Delivery message','delivery_text','area'),field('Link','link_url','text','Sent as a button. Clicks are counted.'),field('Button label (max 20)','link_label','text'),
h('div',{style:'margin-top:10px'},check('Ask them to follow first','require_follow')),field('Follow message','follow_text','text','Shown with Follow and "I\\'m following" buttons.')));
f.appendChild(h('div',{class:'card'},h('h3',{text:'4. If they never answer'}),field('Send the guide anyway after (minutes, 0 = never)','fallback_minutes','number','Max 1380. Instagram only allows a message within 24 hours of their last message or tap.'),field('Fallback message (blank = reuse the delivery message)','fallback_text','area')));
f.appendChild(h('div',{class:'row'},h('button',{class:'b pri',text:'Save',onclick:function(){var body=Object.assign({},a);body.fallback_minutes=parseInt(a.fallback_minutes,10)||0;api('automation','POST',body).then(function(){toast('Saved');S.editing=null;load()}).catch(function(e){toast(e.message)})}}),h('button',{class:'b',text:'Cancel',onclick:function(){S.editing=null;render()}})));
var ph=h('div',{class:'phone'},h('div',{class:'screen',id:'screen'}));w.appendChild(f);w.appendChild(ph);setTimeout(preview,0);return w}

function preview(){var a=S.editing;var sc=$('#screen');if(!sc)return;sc.textContent='';
function bub(cls,text,extra){var b=h('div',{class:'bub '+cls});b.appendChild(document.createTextNode(text));if(extra)b.appendChild(extra);sc.appendChild(b)}
function fill(t){return (t||'').replace(/\\{\\{\\s*username\\s*\\}\\}/gi,'jordan')}
if(a.match_comment){bub('me','jordan commented: '+((a.keywords||[])[0]||'KEYWORD').toUpperCase());if((a.comment_replies||[]).length)bub('note','Public reply: '+a.comment_replies[0])}else bub('me',(a.keywords||[])[0]||'KEYWORD');
if(a.opener_text){var chips=null;if((a.opener_buttons||[]).length){chips=h('div',{class:'chips',style:'margin-top:8px'});a.opener_buttons.slice(0,13).forEach(function(t){chips.appendChild(h('span',{class:'chip',text:t.slice(0,20)}))})}bub('bot',fill(a.opener_text),chips);bub('me','(they answer)')}
if(a.require_follow){bub('bot',fill(a.follow_text)||'Follow me first, then tap the button and I will send it.',h('div',{class:'btnrow',text:'Follow @'+S.state.mode.handle+'   |   I\\'m following'}));bub('me','I\\'m following')}
bub('bot',fill(a.delivery_text)||'Here it is.',a.link_url?h('div',{class:'btnrow',text:a.link_label||'Open the guide'}):null);
if(a.fallback_minutes>0&&a.opener_text)bub('note','If no answer in '+a.fallback_minutes+' min, the guide goes out anyway')}

function contacts(){var w=h('div',null,h('h2',{text:'Contacts'}));if(!S.contacts.length){w.appendChild(h('div',{class:'card',text:'Nobody yet.'}));return w}
var t=h('table');t.appendChild(h('tr',null,h('th',{text:'Who'}),h('th',{text:'Account / automation'}),h('th',{text:'Via'}),h('th',{text:'Their answer'}),h('th',{text:'State'}),h('th',{text:'When'}),h('th',{text:''})));
S.contacts.forEach(function(c){t.appendChild(h('tr',null,h('td',{text:c.username?'@'+c.username:c.igsid}),h('td',{text:(c.account_handle?'@'+c.account_handle+' | ':'')+(c.automation_name||'')}),h('td',{text:c.source+(c.comment_text?': '+c.comment_text:'')}),h('td',{text:c.answer||''}),h('td',{text:c.state+(c.clicked_at?' | clicked':'')}),h('td',{text:when(c.created_at)}),
h('td',null,h('button',{class:'b bad',text:'Delete',onclick:function(){if(confirm('Delete everything about this person?'))api('contact/'+encodeURIComponent(c.igsid)+'/delete','POST',{}).then(function(){S.contacts=S.contacts.filter(function(x){return x.igsid!==c.igsid});render()})}}))))});
w.appendChild(h('div',{class:'card',style:'overflow:auto'},t));return w}

function logView(){var w=h('div',null,h('h2',{text:'Log'}),h('div',{class:'hint',text:'Newest first. Dry run entries show exactly what would have been sent.'}));var t=h('table');t.appendChild(h('tr',null,h('th',{text:'When'}),h('th',{text:'Kind'}),h('th',{text:'Status'}),h('th',{text:'Detail'})));
S.log.forEach(function(l){var d=l.detail||'';var p=l.payload||'';t.appendChild(h('tr',null,h('td',{text:when(l.at)}),h('td',{text:l.kind}),h('td',{class:'s-'+l.status,text:l.status}),h('td',{text:d+(d&&p?'  ':'')+p.slice(0,300)})))});
w.appendChild(h('div',{class:'card',style:'overflow:auto'},t));return w}

function setup(){var m=S.state.mode;var base=S.state.urls.base||location.origin;var w=h('div',null,h('h2',{text:'Setup and test'}));
function row(ok,text){return h('div',{style:'margin:6px 0'},h('span',{style:'color:var(--'+(ok?'ok':'bad')+')',text:ok?'OK  ':'MISSING  '}),text)}
w.appendChild(h('div',{class:'card'},h('h3',{text:'Checks'}),row(m.hasToken,'Instagram access token (secret IG_ACCESS_TOKEN)'),row(m.hasAppSecret,'Instagram app secret (secret IG_APP_SECRET), verifies every webhook'),row(m.hasVerifyToken,'Webhook verify token (secret VERIFY_TOKEN)'),row(!m.dryRunFlag,'DRY_RUN is false in wrangler.jsonc'+(m.dryRunFlag?' (still true, nothing is sent)':''))));
(function(){var card=h('div',{class:'card'},h('h3',{text:'Instagram accounts'}),h('div',{class:'hint',text:'One bot, one admin page, several handles. Each automation belongs to one account. The ID is the long number on Meta\\'s API setup page next to the handle.'}));
(S.state.accounts||[]).forEach(function(x){card.appendChild(h('div',{class:'row',style:'margin-top:10px'},h('b',{text:'@'+x.handle}),h('span',{class:'hint grow',text:x.id}),h('button',{class:'b bad',text:'Remove',onclick:function(){if(confirm('Remove @'+x.handle+'?'))api('account/'+encodeURIComponent(x.id),'DELETE').then(load).catch(function(e){toast(e.message)})}})))});
var aid=h('input',{type:'text',placeholder:'Account ID, digits only'});var ah=h('input',{type:'text',placeholder:'Handle, no @'});
card.appendChild(h('div',{style:'margin-top:14px'},h('label',{text:'Add an account'}),aid,h('div',{style:'margin-top:6px'},ah),h('div',{style:'margin-top:10px'},h('button',{class:'b pri',text:'Add account',onclick:function(){api('account','POST',{id:aid.value,handle:ah.value}).then(function(){toast('Added');load()}).catch(function(e){toast(e.message)})}}))));
w.appendChild(card)})();
w.appendChild(h('div',{class:'card'},h('h3',{text:'Paste these into Meta'}),h('div',null,'Callback URL: ',h('code',{text:base+'/webhook'})),h('div',{style:'margin-top:6px'},'Privacy policy URL: ',h('code',{text:base+'/privacy'})),h('div',{style:'margin-top:6px'},'Data deletion URL: ',h('code',{text:base+'/data-deletion'}))));
if(m.dryRun){var type=h('select');[['comment','Comment on a reel'],['dm','DM'],['followed','Tap "I\\'m following"']].forEach(function(x){type.appendChild(h('option',{value:x[0],text:x[1]}))});
var acc=h('select');(S.state.accounts||[]).forEach(function(x){acc.appendChild(h('option',{value:x.id,text:'@'+x.handle}))});var user=h('input',{type:'text',value:'tester'});var text=h('input',{type:'text',placeholder:'what they type, e.g. BUILD'});var media=h('input',{type:'text',placeholder:'media ID, or * for any post',value:'*'});var run=h('input',{type:'text',placeholder:'run id (only for the follow tap)'});
w.appendChild(h('div',{class:'card'},h('h3',{text:'Simulate a person (dry run only)'}),h('div',{class:'hint',text:'Runs the real flow and writes what it would send to the Log. Use a username containing "nofollow" to test the follow gate. To answer the question, simulate a DM with their answer.'}),
h('label',{text:'Account that receives it'}),acc,h('label',{text:'Type'}),type,h('label',{text:'Username'}),user,h('label',{text:'Text'}),text,h('label',{text:'Media ID (comments)'}),media,h('label',{text:'Run ID'}),run,
h('div',{style:'margin-top:12px'},h('button',{class:'b pri',text:'Run it',onclick:function(){api('simulate','POST',{account_id:acc.value,type:type.value,username:user.value,text:text.value,media_id:media.value,run_id:run.value}).then(function(){toast('Done, check the Log and Contacts tabs')}).catch(function(e){toast(e.message)})}}))))}
return w}
load();
})();
</script></body></html>`;
