'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const rooms=new Map(),port=Number(process.env.PORT||3000);
// Mật khẩu quản trị chỉ nằm trong biến môi trường Render, KHÔNG ghi vào mã nguồn công khai.
const ADMIN_KEY=process.env.ZOMBIE_ADMIN_KEY||'';
const guns=[{damage:35,rate:230},{damage:25,rate:100},{damage:95,rate:710},{damage:160,rate:1100}];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const send=(s,o)=>{if(s?.writable){let b=Buffer.from(JSON.stringify(o));s.write(Buffer.concat([b.length<126?Buffer.from([129,b.length]):Buffer.from([129,126,b.length>>8,b.length&255]),b]));}};
const all=(r,o)=>{for(const p of r.players.values())send(p.s,o);};
function spawn(r){if(r.z.size>=32)return;let p=r.players.values().next().value;if(!p)return;let a=Math.random()*Math.PI*2,d=23+Math.random()*35;r.z.set(++r.next,{id:r.next,x:clamp(p.x+Math.cos(a)*d,-115,115),z:clamp(p.z+Math.sin(a)*d,-115,115),hp:85+r.wave*10,v:r.next%4,hit:0});}
function leave(p){if(!p.room)return;let r=p.room;r.players.delete(p.id);if(p.host&&r.players.size){let q=r.players.values().next().value;q.host=true;send(q.s,{type:'promoted'});}if(!r.players.size)rooms.delete(r.code);}
function cmd(p,raw){let r=p.room;if(!p.admin){send(p.s,{type:'notice',message:'Bạn chưa được xác thực quyền Admin'});return;}let [c,arg,arg2]=String(raw||'').replace(/^\//,'').toLowerCase().split(/\s+/),n=clamp(Number(arg)||10,1,25),msg='';
switch(c){case 'help':msg='clear, meteor 10, fly, god, freeze, spawn 10, heal, ammo, wave 5, speed 2, tp 0 0, revive, reset';break;
case 'clear':r.z.clear();msg='Đã xóa toàn bộ zombie';break;
case 'meteor':for(let i=0;i<n;i++){let x=p.x+(Math.random()-.5)*40,z=p.z+(Math.random()-.5)*40;all(r,{type:'meteor',x,z});for(let [k,v] of r.z)if(Math.hypot(v.x-x,v.z-z)<9)r.z.delete(k);}msg='Đã thả '+n+' thiên thạch';break;
case 'fly':p.fly=!p.fly;msg='Chế độ bay '+(p.fly?'BẬT':'TẮT');break;
case 'god':p.god=!p.god;msg='Bất tử '+(p.god?'BẬT':'TẮT');break;
case 'freeze':r.freeze=!r.freeze;msg='Đóng băng '+(r.freeze?'BẬT':'TẮT');break;
case 'spawn':for(let i=0;i<n;i++)spawn(r);msg='Triệu hồi '+n+' zombie';break;
case 'heal':p.hp=100;msg='Máu đã hồi đầy';break;
case 'ammo':p.refill=true;msg='Đã bật đạn vô hạn';break;
case 'wave':r.wave=clamp(Number(arg)||1,1,50);msg='Đợt '+r.wave;break;
case 'speed':p.speed=clamp(Number(arg)||2,1,5);msg='Tốc độ x'+p.speed;break;
case 'tp':p.x=clamp(Number(arg)||0,-115,115);p.z=clamp(Number(arg2)||0,-115,115);msg='Đã dịch chuyển';break;
case 'revive':for(let q of r.players.values())q.hp=100;msg='Hồi sinh cả đội';break;
case 'reset':r.z.clear();r.wave=1;r.kills=0;msg='Đã khởi động lại';break;
default:msg='Không rõ lệnh, nhập help';}
send(p.s,{type:'notice',message:msg});}
function packet(p,m){if(!m||typeof m!=='object')return;if(!p.room){if(m.type!=='create'&&m.type!=='join')return;let r;if(m.type==='create'){let code;do{code=crypto.randomBytes(3).toString('hex').toUpperCase()}while(rooms.has(code));r={code,players:new Map(),z:new Map(),next:0,wave:1,kills:0,freeze:false,spawnAt:0};rooms.set(code,r);p.host=true;}else{r=rooms.get(String(m.code||'').toUpperCase().trim());if(!r||r.players.size>=2){send(p.s,{type:'error',message:r?'Phòng đã đủ 2 người':'Không tìm thấy phòng'});return;}}p.room=r;p.admin=false;p.adminFailures=0;p.adminBlockedUntil=0;p.id=crypto.randomBytes(4).toString('hex');p.name=String(m.name||'Chiến binh').replace(/[<>]/g,'').slice(0,18);p.x=p.host?0:3;p.z=10;p.y=1.7;p.yaw=0;p.pitch=0;p.hp=100;p.kills=0;p.fly=false;p.god=false;p.speed=1;p.shotAt=0;p.moved=Date.now();r.players.set(p.id,p);send(p.s,{type:'welcome',id:p.id,code:r.code,host:p.host});return;}
let r=p.room;
if(m.type==='admin-login'){
  if(p.admin){send(p.s,{type:'admin-auth',ok:true});return;}
  const now=Date.now();
  if(now<p.adminBlockedUntil){send(p.s,{type:'admin-auth',ok:false,message:'Thử quá nhiều lần, hãy đợi 15 phút.'});return;}
  const value=typeof m.password==='string'?m.password.slice(0,120):'';
  const given=Buffer.from(value,'utf8'),secret=Buffer.from(ADMIN_KEY,'utf8');
  const ok=secret.length>=20&&given.length===secret.length&&crypto.timingSafeEqual(given,secret);
  if(ok){p.admin=true;p.adminFailures=0;send(p.s,{type:'admin-auth',ok:true});}
  else{p.adminFailures++;if(p.adminFailures>=5){p.adminBlockedUntil=now+15*60000;p.adminFailures=0;}
    send(p.s,{type:'admin-auth',ok:false,message:'Mã Admin không đúng.'});}
  return;
}
if(m.type==='move'){let x=Number(m.x),z=Number(m.z),y=Number(m.y);if(![x,z,y].every(Number.isFinite))return;let t=Date.now(),dt=clamp((t-p.moved)/1000,.01,.3);p.moved=t;let dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz),max=15*dt*p.speed+1;if(d>max){dx*=max/d;dz*=max/d;}p.x=clamp(p.x+dx,-118,118);p.z=clamp(p.z+dz,-118,118);p.y=p.fly?clamp(y,1.7,50):1.7;p.yaw=Number(m.yaw)||0;p.pitch=clamp(Number(m.pitch)||0,-1.5,1.5);}
if(m.type==='shoot'){let now=Date.now(),gi=clamp(Number(m.gun)||0,0,3)|0,g=guns[gi];if(now-p.shotAt<g.rate||p.hp<=0)return;p.shotAt=now;let ax=-Math.sin(p.yaw),az=-Math.cos(p.yaw),best=null,bestDist=999;for(let z of r.z.values()){let dx=z.x-p.x,dz=z.z-p.z,t=dx*ax+dz*az,off=Math.abs(dx*az-dz*ax);if(t>0&&t<115&&off<(gi===2?2.1:.9)&&t<bestDist){best=z;bestDist=t;}}if(best){best.hp-=g.damage;if(best.hp<=0){r.z.delete(best.id);p.kills++;r.kills++;if(r.kills%18===0)r.wave++;}all(r,{type:'hit',id:p.id,x:best.x,z:best.z});}}
if(m.type==='admin')cmd(p,m.command);
}
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));return;}let pathname=req.url==='/'?'/index.html':req.url.split('?')[0];if(!['/index.html','/game.js','/style.css'].includes(pathname)){res.writeHead(404);res.end('Not found');return;}let file=path.join(__dirname,'public',pathname.slice(1));fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Missing client');return;}res.writeHead(200,{'Content-Type':pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(data);});});
server.on('upgrade',(req,s)=>{if(req.url!=='/ws'||!req.headers['sec-websocket-key']){s.destroy();return;}let accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');s.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');let p={s,room:null,host:false},buf=Buffer.alloc(0),closed=false;const cleanup=()=>{if(!closed){closed=true;leave(p);}};s.on('close',cleanup);s.on('error',cleanup);s.on('data',d=>{buf=Buffer.concat([buf,d]);if(buf.length>70000){s.destroy();return;}while(buf.length>=2){let opcode=buf[0]&15,len=buf[1]&127,off=2;if(!(buf[1]&128)){s.destroy();return;}if(len===126){if(buf.length<4)return;len=buf.readUInt16BE(2);off=4;}else if(len===127){s.destroy();return;}if(buf.length<off+4+len)return;let mask=buf.subarray(off,off+4),body=Buffer.from(buf.subarray(off+4,off+4+len));buf=buf.subarray(off+4+len);for(let i=0;i<body.length;i++)body[i]^=mask[i%4];if(opcode===8){s.end();return;}if(opcode===9){s.write(Buffer.from([0x8a,0]));continue;}if(opcode===1){try{packet(p,JSON.parse(body.toString()))}catch(e){}}}})});
setInterval(()=>{let now=Date.now();for(let r of rooms.values()){if(now-r.spawnAt>Math.max(600,2200-r.wave*80)){spawn(r);r.spawnAt=now;}for(let z of r.z.values()){let list=[...r.players.values()].filter(p=>p.hp>0).sort((a,b)=>Math.hypot(z.x-a.x,z.z-a.z)-Math.hypot(z.x-b.x,z.z-b.z)),p=list[0];if(!p)continue;let dx=p.x-z.x,dz=p.z-z.z,d=Math.hypot(dx,dz);if(!r.freeze&&d>1.3){let v=Math.min((1.6+.1*r.wave)*.08,d-1.3);z.x+=dx/d*v;z.z+=dz/d*v;z.yaw=Math.atan2(dx,dz);}else if(d<1.85&&!p.god&&now-z.hit>850){z.hit=now;p.hp=Math.max(0,p.hp-9);}}
all(r,{type:'state',players:[...r.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,yaw:p.yaw,hp:p.hp,kills:p.kills,fly:p.fly,god:p.god})),zombies:[...r.z.values()].map(z=>({id:z.id,x:z.x,z:z.z,yaw:z.yaw,v:z.v})),wave:r.wave});}},80);
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Zombie Outbreak Online ready'));
