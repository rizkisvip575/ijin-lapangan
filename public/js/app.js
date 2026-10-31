(function(){
'use strict';
/* ---------- util ---------- */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse=s=>{const a=s.split('-').map(Number);return new Date(a[0],a[1]-1,a[2]);};
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return ymd(d);};
const todayStr=()=>ymd(new Date());
const diffDays=(a,b)=>Math.round((parse(b)-parse(a))/86400000)+1;
const rangeDays=(a,b)=>{const o=[];let c=a,g=0;while(c<=b&&g++<400){o.push(c);c=addDays(c,1);}return o;};
const fmtTgl=(s,o)=>parse(s).toLocaleDateString('id-ID',o||{day:'numeric',month:'short'});
const fmtRange=(a,b)=>a===b?fmtTgl(a,{weekday:'short',day:'numeric',month:'short',year:'numeric'}):fmtTgl(a)+' – '+fmtTgl(b,{day:'numeric',month:'short',year:'numeric'});
const namaBulan=ym=>parse(ym+'-01').toLocaleDateString('id-ID',{month:'long',year:'numeric'});
const uid=()=>'x'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const norm=s=>String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
const byId=(arr,id)=>arr.find(x=>x.id===id);
const byNama=(a,b)=>String(a.nama).localeCompare(String(b.nama),'id');
const initials=n=>String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const fmtSize=b=>b>=1048576?(b/1048576).toFixed(1)+' MB':Math.max(1,Math.round(b/1024))+' KB';
function ago(iso){const m=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/60000));if(m<1)return 'baru saja';if(m<60)return m+' mnt lalu';const h=Math.round(m/60);if(h<24)return h+' jam lalu';return Math.round(h/24)+' hari lalu';}
const minsAgo=iso=>Math.round((Date.now()-new Date(iso).getTime())/60000);

const JENIS={sakit:{label:'Izin Sakit',short:'Sakit',code:'S'},cuti:{label:'Cuti',short:'Cuti',code:'C'},izin:{label:'Izin Lainnya',short:'Izin',code:'I'}};
const STATUS={menunggu:'Menunggu',menunggu_tahap1:'Menunggu Tahap 1',menunggu_tahap2:'Menunggu Tahap 2',disetujui:'Disetujui',ditolak:'Ditolak',dibatalkan:'Dibatalkan'};
const LV_NAMA={0:'Karyawan',1:'Pengawas (Foreman/Supervisor/Leader/Officer)',2:'Superintendent/Penanggung Jawab/Kabag',3:'Deputy PM',4:'PJO'};
const isMenunggu=p=>!!p&&(p.status==='menunggu'||p.status==='menunggu_tahap1'||p.status==='menunggu_tahap2');
const tahapOf=p=>p.status==='menunggu_tahap2'?2:1;
const PERAN={superadmin:'Super Admin',admin:'Admin',pengawas:'Pengawas',karyawan:'Karyawan'};
const DEPARTEMEN=['Administrasi','CMS','NSID','Produksi-SMD','Produksi-SMC','Produksi-CH','Produksi-OB','SHE','Workshop & Logistic'];
const TOLAK_CEPAT=['Produksi sedang padat','Personel belum cukup','Surat belum jelas','Hubungi saya langsung'];
const COLS=['karyawan','jabatan','pengajuan','absensi'];

/* ---------- state ---------- */
const S={karyawan:[],jabatan:[],pengajuan:[],absensi:[]};
const ready={karyawan:false,jabatan:false,pengajuan:false,absensi:false};
const lampiranLocal=new Map();
const lastStatus=new Map();
let DB=null,DL=null,CAN_WRITE=null,dbErr='';
const ui={sesi:null,tab:null,modal:null,filter:'semua',dep:'semua',area:'semua',search:'',jabsearch:'',karLimit:100,rejtext:'',rejecting:null,showAll:false,sent:null,
  ln:'',lk:'',loginErr:'',seeding:'',freshForm:false,fa:{nama:'',nik:''},
  cal:{ym:todayStr().slice(0,7),sel:todayStr()},lap:todayStr().slice(0,7),busy:false};
const emptyDraft=()=>({jenis:'sakit',mulai:todayStr(),selesai:todayStr(),pengawasId:'',alasan:'',lampiran:null,err:'',busy:false,prep:false});
let draft=emptyDraft();
let mdraft={};

/* ---------- penyimpanan (server atau lokal) ---------- */
const STANDALONE=!(window.claude&&window.claude.use);
let persistWarned=false;
function persistLocal(){if(DB)return;try{localStorage.setItem('izin_data_v2',JSON.stringify({S:S,L:Array.from(lampiranLocal.entries())}));}catch(e){if(!persistWarned){persistWarned=true;toast('Penyimpanan browser penuh atau diblokir. Data baru mungkin hilang saat halaman dimuat ulang.',{ms:9000});}}}
function loadLocal(){try{const raw=localStorage.getItem('izin_data_v2');if(!raw)return;const d=JSON.parse(raw);COLS.forEach(c=>{if(d.S&&Array.isArray(d.S[c]))S[c]=d.S[c];});(d.L||[]).forEach(p=>lampiranLocal.set(p[0],p[1]));}catch(e){}}
function localUpsert(col,id,data){const i=S[col].findIndex(x=>x.id===id);const o=Object.assign({id:id},data);if(i>=0)S[col][i]=o;else S[col].push(o);persistLocal();scheduleRender();}
async function put(col,id,data){
  if(col==='lampiran'){ if(DB)await DB.collection('lampiran').doc(id).set(data); else{lampiranLocal.set(id,data);persistLocal();} return; }
  if(DB)await DB.collection(col).doc(id).set(data); else localUpsert(col,id,data);
}
async function patch(col,id,data){
  if(DB)await DB.collection(col).doc(id).update(data);
  else{const i=S[col].findIndex(x=>x.id===id);if(i>=0){S[col][i]=Object.assign({},S[col][i],data);persistLocal();scheduleRender();}}
}
async function remove(col,id){
  if(DB)await DB.collection(col).doc(id).delete();
  else{S[col]=S[col].filter(x=>x.id!==id);persistLocal();scheduleRender();}
}
async function getLampiran(id){
  if(!DB)return lampiranLocal.get(id)||null;
  const s=await DB.collection('lampiran').doc(id).get();
  return s.exists?s.data():null;
}
function subscribe(col){
  DB.collection(col).onSnapshot(snap=>{
    const list=snap.docs.map(d=>Object.assign({id:d.id},d.data()));
    if(col==='pengajuan')notifyChanges(list,!ready.pengajuan);
    S[col]=list;ready[col]=true;scheduleRender();
  },err=>{console.error(err);dbErr=(err&&err.code)||'error';ready[col]=true;scheduleRender();});
}
function notifyChanges(list,first){
  const me=meUser();
  list.forEach(p=>{
    const prev=lastStatus.get(p.id);
    if(!first&&me){
      if(((prev===undefined&&isMenunggu(p))||(prev==='menunggu_tahap1'&&p.status==='menunggu_tahap2'))&&bisaAcc(me,p)){
        const k=byId(S.karyawan,p.karyawanId);toast('Pengajuan baru: '+(k?k.nama:'Karyawan')+' ('+JENIS[p.jenis].short+')');
      }
      if(prev==='menunggu_tahap1'&&p.status==='menunggu_tahap2'&&p.karyawanId===me.id)toast('Tahap 1 disetujui. Pengajuan diteruskan ke Tahap 2.');
      if(prev&&prev.indexOf('menunggu')===0&&p.karyawanId===me.id&&(p.status==='disetujui'||p.status==='ditolak')){
        const w=byId(S.karyawan,p.diputuskanOleh);
        toast('Pengajuan Anda '+STATUS[p.status].toLowerCase()+(w?' oleh '+w.nama:'')+'.');
      }
    }
    lastStatus.set(p.id,p.status);
  });
}

/* ---------- turunan data ---------- */
const jabOf=k=>byId(S.jabatan,k.jabatanId);
/* Jabatan "Officer", "Leader", "Koordinator", "Penanggung Jawab" setara Foreman/Supervisor; "Superintendent" minimal pengawas (bisa ACC). Admin/Super Admin tidak diturunkan. */
/* Hierarki: 0 karyawan, 1 Foreman/Supervisor/Leader/Officer, 2 Superintendent/Penanggung Jawab/Kabag/HC, 3 Deputy PM, 4 PJO */
function levelByNama(nama){
  const n=String(nama||'').toUpperCase();
  if(/\bPJO\b/.test(n))return 4;
  if(/DEPUTY\s*(PM|PROJECT\s*MANAGER)|\bDPM\b/.test(n))return 3;
  if(/SUPERINTENDENT|PENANGGUNG\s+JAWAB|\bKABAG\b|\bHC\b/.test(n))return 2;
  if(/\bFOREMAN\b|\bSUPERVISOR\b|\bLEADER\b|\bOFFICER\b|\bKOORDINATOR\b/.test(n))return 1;
  return 0;
}
/* Jabatan admin/superadmin = -1 (di luar alur). Jabatan berperan pengawas tanpa kata kunci dianggap Level 1. */
function levelJab(j){if(!j)return 0;if(j.peran==='admin'||j.peran==='superadmin')return -1;let l=levelByNama(j.nama);if(l===0&&j.peran==='pengawas')l=1;return l;}
const peranByNama=(nama,peran)=>(peran==='karyawan'&&levelByNama(nama)>=1)?'pengawas':peran;
/* jabatan berunsur HC selalu dipetakan ke departemen Administrasi */
const deptEffNama=(jn,dep)=>{const m=String(jn||'');return /\bHC\b/i.test(m)?'Administrasi':(dep||'');};
function ruteAtasan(level,dep){
  const t2=(level>=0&&level<=2)?level+2:null;
  return {tahap_selanjutnya:t2,deptTahap2:(t2!=null&&t2<=2)?dep:''};
}
const peranJab=j=>j?peranByNama(j.nama,j.peran):'karyawan';
const peranOf=k=>{const b=peranJab(jabOf(k));if(b==='admin'||b==='superadmin')return b;const m=manualLv(k);return m!=null?(m>=1?'pengawas':'karyawan'):b;};
/* Semua departemen memakai filter pengawas ketat: hanya pengawas dari departemen yang sama */
const DEPT_KETAT=DEPARTEMEN.slice();
const jabNama=k=>{const j=jabOf(k);return j?j.nama:'—';};
function meUser(){const k=ui.sesi?byId(S.karyawan,ui.sesi):null;return k&&k.aktif!==false?k:null;}
function sisaCuti(k){
  const y=String(new Date().getFullYear());
  const pakai=S.pengajuan.filter(p=>p.karyawanId===k.id&&p.jenis==='cuti'&&p.status==='disetujui'&&String(p.mulai).slice(0,4)===y).reduce((a,p)=>a+(p.durasi||0),0);
  const kuota=k.kuotaCuti==null?12:Number(k.kuotaCuti);
  return {kuota,pakai,sisa:kuota-pakai};
}
const manualLv=k=>{const v=k&&k.levelManual;return(v!=null&&v!==''&&isFinite(v))?Number(v):null;};
/* Tingkatan manual (Super Admin) menimpa level dari jabatan. Admin/Super Admin tetap di luar alur (-1). */
function levelOf(k){if(!k)return 0;const j=jabOf(k);if(j&&(j.peran==='admin'||j.peran==='superadmin'))return -1;const m=manualLv(k);return m!=null?m:levelJab(j);}
const deptEff=k=>k?deptEffNama(jabNama(k),k.departemen):'';
/* Pilihan Tahap 1: atasan tepat 1 tingkat di atas pemohon. Departemen harus sama kecuali target Level 3/4 (global). */
function pengawasList(reqId){
  const me=byId(S.karyawan,reqId);if(!me)return [];
  const L=levelOf(me);if(L<0||L>=4)return [];
  const t=L+1,dep=deptEff(me);
  return S.karyawan.filter(k=>k.aktif!==false&&k.id!==reqId&&levelOf(k)===t&&(t>=3||deptEff(k)===dep))
    .sort((a,b)=>((b.dilokasi?1:0)-(a.dilokasi?1:0))||byNama(a,b));
}
/* Apakah pengajuan p sedang berada di meja approver me? Tahap 1: approver pilihan. Tahap 2: antrean level tepat 2 di atas pemohon (+ departemen untuk Level 2). */
function bisaAcc(me,p){
  if(!me||!isMenunggu(p)||p.karyawanId===me.id)return false;
  const ml=levelOf(me);if(ml<1)return false;
  if(tahapOf(p)===1)return (p.approver_tahap1||p.pengawasId)===me.id;
  return ml===p.tahap_selanjutnya&&(ml>=3||deptEff(me)===p.deptTahap2);
}

/* ---------- hak akses departemen ---------- */
/* superadmin: semua data. admin: hanya karyawan yang departemennya ada di aksesDepartemen. peran lain: tidak dibatasi di sini. */
const isAdminPeran=k=>{const p=k?peranOf(k):'';return p==='admin'||p==='superadmin';};
function scopeOf(me){
  if(!me||peranOf(me)!=='admin')return null;
  return Array.isArray(me.aksesDepartemen)?me.aksesDepartemen:[];
}
function visK(me){const s=scopeOf(me);return s?S.karyawan.filter(k=>s.indexOf(k.departemen)>=0):S.karyawan;}
function visIds(me){const s=scopeOf(me);if(!s)return null;const o=new Set();S.karyawan.forEach(k=>{if(s.indexOf(k.departemen)>=0)o.add(k.id);});return o;}
function visP(me){const ids=visIds(me);return ids?S.pengajuan.filter(p=>ids.has(p.karyawanId)):S.pengajuan;}
function visA(me){const ids=visIds(me);return ids?S.absensi.filter(a=>ids.has(a.karyawanId)):S.absensi;}
function canKar(me,k){
  if(!me||!k)return false;
  if(peranOf(me)==='superadmin')return true;
  const s=scopeOf(me);
  return !!s&&peranOf(k)!=='superadmin'&&s.indexOf(k.departemen)>=0;
}
function deptOpsi(me){const s=scopeOf(me);return s?DEPARTEMEN.filter(d=>s.indexOf(d)>=0):DEPARTEMEN.slice();}
function pendingFor(id){const me=byId(S.karyawan,id);return S.pengajuan.filter(p=>bisaAcc(me,p)).sort((a,b)=>String(a.diajukanPada).localeCompare(String(b.diajukanPada)));}

/* ---------- lampiran ---------- */
const readFile=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('File tidak bisa dibaca.'));r.readAsDataURL(f);});
async function prepLampiran(file){
  if(file.type==='application/pdf'){
    if(file.size>150*1024)throw new Error('PDF terlalu besar (maksimal 150 KB). Kirim foto suratnya atau kecilkan ukuran PDF.');
    return {nama:file.name,tipe:file.type,ukuran:file.size,dataUrl:await readFile(file)};
  }
  if(!/^image\//.test(file.type))throw new Error('Format harus foto atau PDF.');
  const src=await readFile(file);
  const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('Foto tidak bisa dibuka. Coba foto ulang atau pilih format JPG/PNG.'));i.src=src;});
  let max=1400,q=0.72,out='';
  for(let t=0;t<8;t++){
    const sc=Math.min(1,max/Math.max(img.width,img.height));
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*sc));c.height=Math.max(1,Math.round(img.height*sc));
    const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,0,c.width,c.height);
    out=c.toDataURL('image/jpeg',q);
    if(out.length<190000)break;
    max=Math.round(max*0.8);q=Math.max(0.5,q-0.06);
  }
  if(out.length>=225000)throw new Error('Foto terlalu besar untuk dikecilkan. Coba foto dengan resolusi lebih rendah.');
  return {nama:file.name.replace(/\.[^.]+$/,'')+'.jpg',tipe:'image/jpeg',ukuran:Math.round(out.length*0.75),dataUrl:out};
}
function dataUrlToBlob(u){
  const i=u.indexOf(',');const meta=u.slice(5,i);const body=u.slice(i+1);
  if(/;base64/.test(meta)){const bin=atob(body);const a=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)a[k]=bin.charCodeAt(k);return new Blob([a],{type:meta.split(';')[0]});}
  return new Blob([decodeURIComponent(body)],{type:meta.split(';')[0]});
}

/* ---------- toast ---------- */
function toast(msg,o){
  o=o||{};const box=$('#toasts');if(!box)return;
  const el=document.createElement('div');el.className='toast';
  const sp=document.createElement('span');sp.textContent=msg;el.appendChild(sp);
  if(o.action){const b=document.createElement('button');b.type='button';b.textContent=o.action.label;b.onclick=()=>{try{o.action.fn();}catch(e){}el.remove();};el.appendChild(b);}
  box.appendChild(el);setTimeout(()=>el.remove(),o.ms||4500);
}

/* ---------- aksi domain ---------- */
function cekBentrok(karyawanId,a,b){
  return S.pengajuan.find(p=>p.karyawanId===karyawanId&&(isMenunggu(p)||p.status==='disetujui')&&p.mulai<=b&&p.selesai>=a);
}
async function kirim(me){
  const d=draft;d.err='';
  const t=todayStr();
  if(!d.mulai||!d.selesai)d.err='Pilih tanggal mulai dan selesai.';
  else if(d.selesai<d.mulai)d.err='Tanggal selesai tidak boleh sebelum tanggal mulai.';
  else if(d.jenis==='cuti'&&d.mulai<t)d.err='Cuti harus dimulai hari ini atau setelahnya.';
  else if(d.mulai<addDays(t,-7))d.err='Pengajuan mundur maksimal 7 hari.';
  else if(levelOf(me)<0||levelOf(me)>=4)d.err='Jabatan Anda tidak memiliki atasan untuk menyetujui pengajuan.';
  else if(!d.pengawasId)d.err='Pilih atasan untuk Tahap 1.';
  else if(!pengawasList(me.id).some(w=>w.id===d.pengawasId))d.err='Atasan tidak sesuai jenjang atau departemen Anda. Pilih ulang.';
  else if(!d.alasan.trim())d.err='Isi alasan singkat.';
  else if(d.jenis==='sakit'&&!d.lampiran)d.err='Lampirkan foto atau PDF surat sakit.';
  else if(d.jenis==='cuti'&&!d.lampiran)d.err='Lampirkan foto jadwal (schedule) untuk pengajuan cuti.';
  if(!d.err){
    const durasi=diffDays(d.mulai,d.selesai);
    const b=cekBentrok(me.id,d.mulai,d.selesai);
    if(b)d.err='Tanggal ini bertabrakan dengan pengajuan lain ('+fmtRange(b.mulai,b.selesai)+', '+STATUS[b.status].toLowerCase()+').';
  }
  if(d.err){render();return;}
  d.busy=true;render();
  try{
    const id=uid();let lid=null;
    if(d.lampiran){lid='l'+id;await put('lampiran',lid,d.lampiran);}
    await put('pengajuan',id,{karyawanId:me.id,pengawasId:d.pengawasId,jenis:d.jenis,mulai:d.mulai,selesai:d.selesai,durasi:diffDays(d.mulai,d.selesai),
      alasan:d.alasan.trim(),lampiranId:lid,status:'menunggu_tahap1',catatan:'',diajukanPada:new Date().toISOString(),
      approver_tahap1:d.pengawasId,levelPemohon:levelOf(me),tahap_selanjutnya:ruteAtasan(levelOf(me),deptEff(me)).tahap_selanjutnya,deptTahap2:ruteAtasan(levelOf(me),deptEff(me)).deptTahap2,diputuskanTahap1:null,diputuskanTahap1Pada:null});
    ui.sent=id;draft=emptyDraft();
  }catch(e){console.error(e);draft.err='Pengajuan gagal terkirim. Periksa koneksi lalu coba lagi.';draft.busy=false;}
  render();
}
async function putuskan(id,status,catatan){
  const me=meUser();const p=byId(S.pengajuan,id);
  if(!me||!p)return;
  if(!isMenunggu(p)){toast('Pengajuan ini sudah diproses.');return;}
  if(!bisaAcc(me,p)){toast('Pengajuan ini tidak ada di meja Anda.');return;}
  ui.rejecting=null;
  const tahap=tahapOf(p);const prev=p.status;const now=new Date().toISOString();
  /* alur ketat: tahap 1 -> tahap 2 (jika ada) -> disetujui. Tolak di tahap mana pun = final. */
  let next='disetujui';
  if(status==='ditolak')next='ditolak';
  else if(tahap===1&&p.tahap_selanjutnya!=null)next='menunggu_tahap2';
  const data={status:next,catatan:catatan||''};
  if(next==='menunggu_tahap2'){data.diputuskanTahap1=me.id;data.diputuskanTahap1Pada=now;data.diputuskanPada=null;data.diputuskanOleh=null;}
  else{data.diputuskanPada=now;data.diputuskanOleh=me.id;if(next==='disetujui'&&tahap===1){data.diputuskanTahap1=me.id;data.diputuskanTahap1Pada=now;}}
  try{
    await patch('pengajuan',id,data);
    if(next==='disetujui'){
      const days=rangeDays(p.mulai,p.selesai);
      for(let i=0;i<days.length;i+=6){
        await Promise.all(days.slice(i,i+6).map(t=>put('absensi',p.karyawanId+'_'+t,{karyawanId:p.karyawanId,tanggal:t,status:p.jenis,pengajuanId:id,sumber:'sistem'})));
      }
    }
    const k=byId(S.karyawan,p.karyawanId);
    const lbl=next==='menunggu_tahap2'?'Tahap 1 disetujui, lanjut Tahap 2: ':next==='disetujui'?'ACC ':'Ditolak: ';
    toast(lbl+(k?k.nama:''),{ms:6500,action:{label:'Urungkan',fn:()=>urungkan(id,prev,tahap)}});
  }catch(e){console.error(e);toast('Keputusan gagal disimpan. Coba lagi.');}
}
async function urungkan(id,prev,tahap){
  try{
    const rows=S.absensi.filter(a=>a.pengajuanId===id&&a.sumber==='sistem');
    const d={status:prev||'menunggu_tahap1',catatan:'',diputuskanPada:null,diputuskanOleh:null};
    if(tahap===1){d.diputuskanTahap1=null;d.diputuskanTahap1Pada=null;}
    await patch('pengajuan',id,d);
    for(const a of rows)await remove('absensi',a.id);
    toast('Keputusan dibatalkan. Pengajuan kembali ke antrean sebelumnya.');
  }catch(e){console.error(e);toast('Gagal membatalkan keputusan.');}
}
async function batalkan(id){
  const p=byId(S.pengajuan,id);if(!p||!isMenunggu(p))return;
  try{await patch('pengajuan',id,{status:'dibatalkan'});toast('Pengajuan dibatalkan.');}catch(e){toast('Gagal membatalkan.');}
}
/* isi banyak dokumen sekaligus: lokal ditulis sekali, server dikirim per kelompok */
async function bulk(col,items){
  if(!DB){items.forEach(it=>{const i=S[col].findIndex(x=>x.id===it[0]);const o=Object.assign({id:it[0]},it[1]);if(i>=0)S[col][i]=o;else S[col].push(o);});persistLocal();scheduleRender();return;}
  const c=DB.collection(col);
  if(c&&typeof c.setMany==='function'){await c.setMany(items);return;}
  for(let i=0;i<items.length;i+=10)await Promise.all(items.slice(i,i+10).map(it=>c.doc(it[0]).set(it[1])));
}
async function reassignGuard(me,p){return !!me&&(peranOf(me)==='superadmin'||(scopeOf(me)&&visIds(me).has(p.karyawanId)));}
async function toggleLokasi(){
  const me=meUser();if(!me)return;
  try{await patch('karyawan',me.id,{dilokasi:!me.dilokasi});toast(!me.dilokasi?'Anda ditandai di lokasi. Karyawan bisa memilih Anda.':'Anda ditandai tidak di lokasi.');}catch(e){toast('Gagal mengubah status.');}
}
/* ---------- ikon & komponen kecil ---------- */
const IC={
 plus:'<path d="M12 5v14M5 12h14"/>',
 check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
 x:'<path d="M6 6l12 12M18 6L6 18"/>',
 cal:'<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
 list:'<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
 clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
 users:'<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.5-3.2 3-5 6-5s5.5 1.8 6 5M16 5.5a3 3 0 010 6M18 14.3c1.8.6 3 2.2 3.3 4.7"/>',
 tag:'<path d="M3.5 12.2V4.5a1 1 0 011-1h7.7l8.3 8.3a1.4 1.4 0 010 2l-6.3 6.3a1.4 1.4 0 01-2 0z"/><circle cx="8" cy="8" r="1.2"/>',
 file:'<path d="M6 3.5h8l4 4V20a.5.5 0 01-.5.5h-11A.5.5 0 016 20z"/><path d="M14 3.5V8h4"/>',
 download:'<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
 home:'<path d="M4 11l8-6.5 8 6.5v8.5a.5.5 0 01-.5.5H15v-6H9v6H4.5a.5.5 0 01-.5-.5z"/>',
 out:'<path d="M14 4.5h4.5a1 1 0 011 1v13a1 1 0 01-1 1H14M10 8l-4 4 4 4M6 12h9"/>',
 up:'<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19.5h14"/>',
 left:'<path d="M15 6l-6 6 6 6"/>',
 right:'<path d="M9 6l6 6-6 6"/>',
 clip:'<path d="M20 11.5l-7.8 7.8a4.5 4.5 0 01-6.4-6.4l8.2-8.2a3 3 0 014.3 4.3l-8.1 8.1a1.5 1.5 0 01-2.1-2.1l7.4-7.4"/>',
 sliders:'<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'
};
const icon=(n,s)=>'<svg class="ic" width="'+(s||20)+'" height="'+(s||20)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+IC[n]+'</svg>';
const chipJenis=j=>'<span class="chip '+j+'">'+JENIS[j].label+'</span>';
const chipStatus=s=>'<span class="chip '+s+'">'+STATUS[s]+'</span>';
const avatar=(k,sm)=>'<span class="av'+(sm?' sm':'')+'">'+esc(initials(k&&k.nama))+'</span>';
const nameOf=id=>{const k=byId(S.karyawan,id);return k?k.nama:'(dihapus)';};
const emptyBox=t=>'<div class="empty">'+t+'</div>';

/* ---------- tampilan utama ---------- */
function view(){
  if(!ready.karyawan||!ready.jabatan)return '<div class="boot">Memuat data…</div>';
  const me=meUser();
  if(!me)return loginView();
  return appView(me);
}
function connPill(){
  return DB?'<span class="pill-conn"><i></i>Tersambung ke server, data tersinkron otomatis</span>'
           :'<span class="pill-conn off"><i></i>Mode lokal: server tidak terhubung, data tersimpan di browser ini</span>';
}
function loginView(){
  const empty=S.karyawan.length===0;
  const demo=S.karyawan.filter(k=>k.demo&&k.aktif!==false);
  let body='';
  if(empty){
    body='<div class="panel"><h2>Belum ada data</h2><p class="sub">Mulai dengan data contoh (akun admin, pengawas, dan karyawan siap pakai) atau buat akun admin pertama.</p>'+
      '<button class="btn primary block" type="button" data-act="seed"'+(ui.seeding?' disabled':'')+'>'+(ui.seeding?'Memuat data contoh… '+esc(ui.seeding):'Muat data contoh')+'</button>'+
      (ui.freshForm?'<form id="f-fresh" class="list"><div class="field"><label for="a-nama">Nama Super Admin</label><input type="text" id="a-nama" data-l="fa.nama" value="'+esc(ui.fa.nama)+'" autocomplete="off"></div>'+
      '<div class="field"><label for="a-nik">NIK Super Admin</label><input type="text" id="a-nik" data-l="fa.nik" value="'+esc(ui.fa.nik)+'" autocomplete="off"></div>'+
      (ui.loginErr?'<p class="err">'+esc(ui.loginErr)+'</p>':'')+
      '<button class="btn block" type="submit">Buat Super Admin pertama</button></form>'
      :'<button class="btn ghost block" type="button" data-act="fresh">Mulai tanpa data contoh</button>')+'</div>';
  }else{
    body='<form id="f-login" class="panel" autocomplete="off"><div class="field"><label for="l-nama">Nama lengkap</label><input type="text" id="l-nama" data-l="ln" value="'+esc(ui.ln)+'" placeholder="Sesuai data HR" autocapitalize="words"></div>'+
      '<div class="field"><label for="l-nik">NIK karyawan</label><input type="text" id="l-nik" data-l="lk" value="'+esc(ui.lk)+'" inputmode="text" autocapitalize="off" placeholder="Nomor induk karyawan"></div>'+
      (ui.loginErr?'<p class="err" role="alert">'+esc(ui.loginErr)+'</p>':'')+
      '<button class="btn primary block big" type="submit">Masuk</button></form>'+
      (demo.length?'<div class="demo"><b>Akun demo</b><span class="hint">Ketuk untuk mengisi nama dan NIK.</span>'+
        demo.sort((a,b)=>String(a.nik).localeCompare(String(b.nik))).map(k=>'<button type="button" class="acc" data-act="demo-fill" data-id="'+esc(k.id)+'"><span><b>'+esc(k.nama)+'</b><br><small>'+esc(jabNama(k))+' · '+PERAN[peranOf(k)]+'</small></span><span class="mono">'+esc(k.nik)+'</span></button>').join('')+'</div>':'');
  }
  const warn=(CAN_WRITE===false)?'<p class="note warn">Akun ini hanya bisa melihat data. Minta pemilik server memberi akses tulis agar bisa menyimpan data.</p>':'';
  return '<div class="login"><div class="hero"><span class="mark" style="width:44px;height:44px">'+icon('cal',24)+'</span><h1>Izin Lapangan</h1>'+
    '<p class="sub">Pengajuan izin sakit dan cuti karyawan lapangan, disetujui langsung oleh pengawas dari ponsel.</p></div>'+connPill()+warn+body+'</div>';
}
const TABS={
  karyawan:[{id:'ajukan',l:'Ajukan',i:'plus'},{id:'riwayat',l:'Riwayat',i:'list'},{id:'kalender',l:'Kalender',i:'cal'}],
  pengawas:[{id:'menunggu',l:'Menunggu',i:'clock',badge:1},{id:'riwayat',l:'Keputusan',i:'list'},{id:'kalender',l:'Kalender',i:'cal'},{id:'ajukan',l:'Cuti Saya',i:'plus'}],
  admin:[{id:'ringkasan',l:'Ringkasan',i:'home'},{id:'pengajuan',l:'Pengajuan',i:'list',badge:1},{id:'kalender',l:'Kalender',i:'cal'},{id:'karyawan',l:'Karyawan',i:'users'},{id:'jabatan',l:'Jabatan',i:'tag'},{id:'laporan',l:'Laporan',i:'file'}]
};
TABS.superadmin=TABS.admin.concat([{id:'pengaturan',l:'Pengaturan',i:'sliders'}]);
function appView(me){
  const peran=peranOf(me);const tabs=TABS[peran];
  if(!tabs.some(t=>t.id===ui.tab))ui.tab=tabs[0].id;
  const nPend=peran==='pengawas'?pendingFor(me.id).length:visP(me).filter(isMenunggu).length;
  const head='<header class="top"><div class="brand"><span class="mark">'+icon('cal',18)+'</span><span class="bname">Izin Lapangan</span></div>'+
    '<div class="who">'+avatar(me)+'<div class="whotxt"><b>'+esc(me.nama)+'</b><small>'+esc(jabNama(me))+' · '+PERAN[peran]+'</small></div>'+
    '<button class="btn ghost sm out" type="button" data-act="logout" aria-label="Keluar">'+icon('out',16)+'<span>Keluar</span></button></div></header>';
  const nav='<nav class="nav" aria-label="Menu utama">'+tabs.map(t=>'<button type="button" class="tab" data-act="tab" data-tab="'+t.id+'"'+(ui.tab===t.id?' aria-current="page"':'')+'>'+icon(t.i,18)+'<span>'+t.l+'</span>'+(t.badge&&nPend?'<span class="badge">'+nPend+'</span>':'')+'</button>').join('')+'</nav>';
  const fn={ajukan:tabAjukan,riwayat:peran==='pengawas'?tabKeputusan:tabRiwayat,menunggu:tabMenunggu,kalender:tabKalender,ringkasan:tabRingkasan,pengajuan:tabPengajuan,karyawan:tabKaryawan,jabatan:tabJabatan,laporan:tabLaporan,pengaturan:tabPengaturan}[ui.tab];
  return connPill()+head+nav+'<main class="main">'+(isAdminPeran(me)?scopeBanner(me):'')+fn(me)+'</main>'+modalView();
}

/* ---------- karyawan: form pengajuan ---------- */
function tabAjukan(me){
  const own=peranOf(me)==='pengawas'?'<section class="panel"><header><h2>Riwayat pengajuan saya</h2></header>'+ownList(me)+'</section>':'';
  if(ui.sent){
    const p=byId(S.pengajuan,ui.sent);const w=p?byId(S.karyawan,p.approver_tahap1||p.pengawasId):null;
    return '<section class="panel"><div class="note ok"><b>Pengajuan terkirim.</b></div>'+
      (p?'<div class="req-m">'+chipJenis(p.jenis)+'<span class="when">'+fmtRange(p.mulai,p.selesai)+' · '+p.durasi+' hari</span></div>':'')+
      (w?'<div class="note warn"><b>Langkah berikutnya:</b> hubungi <b>'+esc(w.nama)+'</b> ('+esc(jabNama(w))+(w.departemen?', '+esc(w.departemen):'')+') secara langsung agar Tahap 1 segera diproses. Notifikasi sudah masuk ke ponselnya, tidak ada email.</div>':'')+
      (p&&p.tahap_selanjutnya!=null?'<div class="note">Setelah Tahap 1 disetujui, pengajuan otomatis diteruskan ke Tahap 2: <b>'+esc(LV_NAMA[p.tahap_selanjutnya])+'</b>'+(p.deptTahap2?' ('+esc(p.deptTahap2)+')':'')+'.</div>':'')+
      '<div class="row-act"><button class="btn primary" type="button" data-act="tab" data-tab="riwayat">Lihat status</button><button class="btn" type="button" data-act="new-request">Ajukan lagi</button></div></section>'+own;
  }
  const L=levelOf(me);
  if(L<0||L>=4)return '<section class="panel"><header><h2>Ajukan izin atau cuti</h2></header>'+emptyBox(L>=4?'Jabatan Anda berada di level tertinggi (PJO), jadi tidak ada atasan yang bisa menyetujui pengajuan.':'Peran Anda tidak mengajukan izin.')+'</section>'+own;
  const d=draft;const t=todayStr();
  const durasi=d.mulai&&d.selesai&&d.selesai>=d.mulai?diffDays(d.mulai,d.selesai):0;
  const sc=sisaCuti(me);
  const rt=ruteAtasan(L,deptEff(me));
  const shown=pengawasList(me.id);
  const alur='<div class="note"><b>Alur persetujuan:</b> Tahap 1 oleh '+esc(LV_NAMA[L+1])+' pilihan Anda'+(rt.tahap_selanjutnya!=null?', lalu Tahap 2 otomatis ke <b>'+esc(LV_NAMA[rt.tahap_selanjutnya])+'</b>'+(rt.deptTahap2?' ('+esc(rt.deptTahap2)+')':'')+'.':' (final).')+'</div>';
  const seg='<div class="seg" role="radiogroup" aria-label="Jenis pengajuan">'+Object.keys(JENIS).map(j=>'<label class="'+(d.jenis===j?'on':'')+'"><input type="radio" name="jenis" value="'+j+'" data-b="jenis"'+(d.jenis===j?' checked':'')+'>'+JENIS[j].label+'</label>').join('')+'</div>';
  const minD=d.jenis==='cuti'?t:addDays(t,-7);
  const up=d.lampiran?
    '<div class="file">'+(/^image\//.test(d.lampiran.tipe)?'<img alt="Pratinjau surat" src="'+d.lampiran.dataUrl+'">':'<span class="fx">'+icon('file',22)+'</span>')+
    '<div class="meta"><b>'+esc(d.lampiran.nama)+'</b><small class="muted">'+fmtSize(d.lampiran.ukuran)+'</small></div><button type="button" class="btn ghost sm" data-act="rm-file">Hapus</button></div>'
    :'<label class="upload" for="f-file">'+icon('up',24)+'<span><b>'+(d.prep?'Memproses file…':'Unggah foto atau PDF')+'</b><br><small class="muted">Ketuk untuk memotret atau memilih file</small></span></label>';
  const pick=shown.length?'<div class="pick" role="radiogroup" aria-label="Atasan Tahap 1">'+shown.map(k=>'<label class="pk'+(d.pengawasId===k.id?' on':'')+'"><input type="radio" name="pengawas" value="'+esc(k.id)+'" data-b="pengawasId"'+(d.pengawasId===k.id?' checked':'')+'>'+avatar(k,1)+
    '<span class="t"><b>'+esc(k.nama)+'</b><small>'+esc(jabNama(k))+(k.departemen?' · '+esc(k.departemen):'')+'</small></span><span class="loc'+(k.dilokasi?'':' off')+'"><i></i>'+(k.dilokasi?'Di lokasi':'Tidak di lokasi')+'</span></label>').join('')+'</div>'
    :emptyBox('Belum ada '+esc(LV_NAMA[L+1])+' aktif'+(L+1<=2&&deptEff(me)?' di departemen '+esc(deptEff(me)):'')+'. Hubungi admin.');
  const form='<form id="f-ajukan" class="panel" novalidate><header><div><h2>Ajukan izin atau cuti</h2><p class="sub">Pilih jenis, tanggal, dan atasan Tahap 1 yang sedang di lokasi.</p></div></header>'+alur+seg+
    '<div class="grid2 keep"><div class="field"><label for="f-mulai">Tanggal mulai</label><input type="date" id="f-mulai" data-b="mulai" value="'+esc(d.mulai)+'" min="'+minD+'"></div>'+
    '<div class="field"><label for="f-selesai">Tanggal selesai</label><input type="date" id="f-selesai" data-b="selesai" value="'+esc(d.selesai)+'" min="'+esc(d.mulai||minD)+'"></div></div>'+
    '<div class="durasi">'+(durasi?'<b>'+durasi+' hari</b><span>'+esc(fmtRange(d.mulai,d.selesai))+'</span>':'<span>Pilih tanggal untuk melihat durasi</span>')+
    (d.jenis==='cuti'?'<span class="muted">Sisa cuti '+sc.sisa+' dari '+sc.kuota+' hari</span>':'')+'</div>'+
    '<div class="field"><span class="lbl">'+(d.jenis==='sakit'?'Surat sakit <small>(wajib)</small>':d.jenis==='cuti'?'Foto jadwal (schedule) <small>(wajib untuk cuti)</small>':'Lampiran <small>(opsional)</small>')+'</span>'+up+
    '<input type="file" id="f-file" accept="image/*,application/pdf" class="sr" tabindex="-1"><span class="hint">'+(d.jenis==='cuti'?'Cuti wajib melampirkan foto jadwal (schedule). ':'')+'Foto dikecilkan otomatis. PDF maksimal 150 KB.</span></div>'+
    '<div class="field"><span class="lbl">Atasan Tahap 1 <small>('+esc(LV_NAMA[L+1])+')</small></span>'+pick+'</div>'+
    '<div class="field"><label for="f-alasan">Alasan singkat <small class="muted">(<span id="alasan-count">'+d.alasan.length+'</span>/140)</small></label><textarea id="f-alasan" data-b="alasan" maxlength="140" placeholder="Contoh: demam sejak semalam">'+esc(d.alasan)+'</textarea></div>'+
    (d.err?'<p class="err" role="alert">'+esc(d.err)+'</p>':'')+
    '<button class="btn primary block big" type="submit"'+(d.busy||d.prep?' disabled':'')+'>'+(d.busy?'Mengirim…':'Kirim pengajuan')+'</button></form>';
  return form+own;
}

/* ---------- daftar pengajuan sendiri ---------- */
function ownList(me){
  const list=S.pengajuan.filter(p=>p.karyawanId===me.id).sort((a,b)=>String(b.diajukanPada).localeCompare(String(a.diajukanPada)));
  if(!list.length)return emptyBox('Belum ada pengajuan.');
  return '<div class="list">'+list.map(p=>{
    const w=byId(S.karyawan,p.approver_tahap1||p.pengawasId);const dec=p.diputuskanOleh?byId(S.karyawan,p.diputuskanOleh):null;
    const t1=p.diputuskanTahap1?byId(S.karyawan,p.diputuskanTahap1):null;
    const t2txt=p.tahap_selanjutnya!=null?LV_NAMA[p.tahap_selanjutnya]+(p.deptTahap2?' ('+p.deptTahap2+')':''):'';
    let info='';
    if(p.status==='menunggu'||p.status==='menunggu_tahap1')info='<div class="note warn">Tahap 1: menunggu <b>'+esc(w?w.nama:'atasan')+'</b>. Hubungi langsung agar segera diproses.'+(t2txt?' Setelah itu otomatis ke Tahap 2 ('+esc(t2txt)+').':'')+'</div>';
    else if(p.status==='menunggu_tahap2')info='<div class="note warn">Tahap 1 disetujui oleh '+esc(t1?t1.nama:(w?w.nama:'atasan'))+'. Sekarang menunggu Tahap 2: <b>'+esc(t2txt)+'</b>.</div>';
    else if(p.status==='disetujui')info='<div class="note ok">Disetujui'+(dec?' oleh '+esc(dec.nama):'')+'. Sampaikan langsung ke atasan di lokasi.'+(p.catatan?' Catatan: '+esc(p.catatan):'')+'</div>';
    else if(p.status==='ditolak')info='<div class="note bad">Ditolak oleh '+esc(dec?dec.nama:'atasan')+(p.catatan?': '+esc(p.catatan):'')+'. Pengajuan berhenti. Hubungi atasan jika perlu.</div>';
    return '<article class="req"><div class="req-m">'+chipJenis(p.jenis)+chipStatus(p.status)+'<span class="ago">'+ago(p.diajukanPada)+'</span></div>'+
      '<div class="when">'+fmtRange(p.mulai,p.selesai)+' · '+p.durasi+' hari</div><p class="why">'+esc(p.alasan)+'</p>'+info+
      '<div class="row-act">'+(p.lampiranId?'<button class="btn sm" type="button" data-act="lamp" data-lid="'+esc(p.lampiranId)+'">'+icon('clip',16)+'Lihat lampiran</button>':'')+
      (isMenunggu(p)?'<button class="btn sm ghost" type="button" data-act="batal" data-id="'+p.id+'">Batalkan</button>':'')+'</div></article>';
  }).join('')+'</div>';
}
function tabRiwayat(me){return '<section class="panel"><header><h2>Riwayat pengajuan</h2></header>'+ownList(me)+'</section>';}

/* ---------- pengawas ---------- */
function reqCard(p,mode){
  const k=byId(S.karyawan,p.karyawanId);const pend=isMenunggu(p);const tahap=tahapOf(p);
  const late=pend&&minsAgo(p.diajukanPada)>=30;
  const sc=(p.jenis==='cuti'&&k)?sisaCuti(k):null;
  const final=tahap===2||p.tahap_selanjutnya==null;
  let acts='';
  if(mode==='pengawas'&&pend){
    acts='<div class="acts"><button type="button" class="btn ok big" data-act="acc" data-id="'+p.id+'">'+icon('check',20)+(final?'ACC Final':'ACC Tahap 1')+'</button>'+
      '<button type="button" class="btn bad-o big" data-act="tolak" data-id="'+p.id+'" aria-expanded="'+(ui.rejecting===p.id)+'">'+icon('x',20)+'Tolak</button></div>'+
      (ui.rejecting===p.id?'<div class="qrej"><span>Ketuk alasan untuk menolak (pengajuan berhenti permanen)</span>'+TOLAK_CEPAT.map(r=>'<button type="button" data-act="tolak-do" data-id="'+p.id+'" data-why="'+esc(r)+'">'+esc(r)+'</button>').join('')+'<div style="display:flex;gap:8px;width:100%;flex-wrap:wrap"><label class="sr" for="tw-'+p.id+'">Alasan lain</label><input type="text" id="tw-'+p.id+'" data-l="rejtext" maxlength="120" placeholder="Tulis alasan lain" value="'+esc(ui.rejtext||'')+'" style="flex:1 1 200px"><button type="button" data-act="tolak-manual" data-id="'+p.id+'">Tolak dengan alasan ini</button></div><button type="button" data-act="tolak" data-id="'+p.id+'">Batal</button></div>':'');
  }
  if(mode==='admin'&&pend){
    if(tahap===1){
      const meA=meUser();const ids=meA?visIds(meA):null;
      const opts=pengawasList(p.karyawanId).filter(w=>!ids||ids.has(w.id)||levelOf(w)>=3||w.id===(p.approver_tahap1||p.pengawasId)).map(w=>'<option value="'+esc(w.id)+'"'+(w.id===(p.approver_tahap1||p.pengawasId)?' selected':'')+'>'+esc(w.nama)+' ('+esc(jabNama(w))+')</option>').join('');
      acts='<div class="field"><label for="re-'+p.id+'">Alihkan atasan Tahap 1</label><select id="re-'+p.id+'" data-reassign="'+p.id+'">'+opts+'</select></div>';
    }else acts='<span class="hint">Tahap 2 antre di level '+esc(LV_NAMA[p.tahap_selanjutnya]||'')+' dan tidak bisa dialihkan manual.</span>';
  }
  const dec=p.diputuskanOleh?byId(S.karyawan,p.diputuskanOleh):null;
  const t1=p.diputuskanTahap1?byId(S.karyawan,p.diputuskanTahap1):null;
  const out=(p.status==='disetujui'||p.status==='ditolak')?'<div class="note '+(p.status==='disetujui'?'ok':'bad')+'">'+STATUS[p.status]+(dec?' oleh '+esc(dec.nama):'')+(p.diputuskanPada?' · '+ago(p.diputuskanPada):'')+(p.catatan?'. '+esc(p.catatan):'')+'</div>':'';
  const t1note=(t1&&!(dec&&dec.id===t1.id))?'<div class="note ok">Tahap 1 disetujui oleh '+esc(t1.nama)+(p.diputuskanTahap1Pada?' · '+ago(p.diputuskanTahap1Pada):'')+'</div>':'';
  const hint2=(mode!=='pengawas')?'<span class="hint">Tahap 1: '+esc(nameOf(p.approver_tahap1||p.pengawasId))+(p.tahap_selanjutnya!=null?' · Tahap 2: '+esc(LV_NAMA[p.tahap_selanjutnya])+(p.deptTahap2?' ('+esc(p.deptTahap2)+')':''):'')+'</span>':'';
  return '<article class="req'+(late&&mode==='pengawas'?' urgent':'')+'"><div class="req-h">'+avatar(k)+'<div class="nm"><b>'+esc(k?k.nama:'(dihapus)')+'</b><small>'+esc(k?jabNama(k):'')+(k&&k.departemen?' · '+esc(k.departemen):'')+(k?' · NIK '+esc(k.nik):'')+'</small></div><span class="ago'+(late?' late':'')+'">'+ago(p.diajukanPada)+'</span></div>'+
    '<div class="req-m">'+chipJenis(p.jenis)+(mode!=='pengawas'?chipStatus(p.status):'<span class="chip plain">Tahap '+tahap+'</span>')+'<span class="when">'+fmtRange(p.mulai,p.selesai)+' · '+p.durasi+' hari</span></div>'+
    '<p class="why">'+esc(p.alasan)+'</p>'+
    (sc?'<span class="hint">Sisa cuti '+sc.sisa+' hari dari '+sc.kuota+'</span>':'')+hint2+
    (p.lampiranId?'<div class="row-act"><button class="btn sm" type="button" data-act="lamp" data-lid="'+esc(p.lampiranId)+'">'+icon('clip',16)+(p.jenis==='sakit'?'Lihat surat sakit':'Lihat lampiran')+'</button></div>':'')+
    t1note+out+acts+'</article>';
}
function tabMenunggu(me){
  const list=pendingFor(me.id);
  const sw='<button type="button" class="sw" role="switch" aria-checked="'+(!!me.dilokasi)+'" data-act="toggle-lokasi"><span class="tg"></span><span class="t"><b>'+(me.dilokasi?'Saya sedang di lokasi':'Saya tidak di lokasi')+'</b><small>'+(me.dilokasi?'Karyawan bisa memilih Anda untuk pengajuan':'Anda tidak muncul di pilihan karyawan')+(me.departemen?' · '+esc(me.departemen):'')+'</small></span></button>';
  return '<section class="panel"><header><div><h2>Menunggu keputusan</h2><p class="sub">'+(list.length?list.length+' pengajuan perlu ACC atau tolak.':'Tidak ada pengajuan yang menunggu.')+'</p></div></header>'+sw+
    (list.length?'<div class="list">'+list.map(p=>reqCard(p,'pengawas')).join('')+'</div>':emptyBox('Semua pengajuan sudah diproses. Pengajuan baru muncul di sini secara langsung.'))+'</section>';
}
function tabKeputusan(me){
  const mine=p=>p.approver_tahap1===me.id||p.pengawasId===me.id||p.diputuskanOleh===me.id||p.diputuskanTahap1===me.id;
  const list=S.pengajuan.filter(p=>mine(p)&&(!isMenunggu(p)||(p.status==='menunggu_tahap2'&&p.diputuskanTahap1===me.id))).sort((a,b)=>String(b.diputuskanPada||b.diputuskanTahap1Pada||b.diajukanPada).localeCompare(String(a.diputuskanPada||a.diputuskanTahap1Pada||a.diajukanPada)));
  return '<section class="panel"><header><h2>Keputusan saya</h2></header>'+(list.length?'<div class="list">'+list.map(p=>reqCard(p,'riwayat')).join('')+'</div>':emptyBox('Belum ada keputusan.'))+'</section>';
}

/* ---------- kalender (semua peran) ---------- */
function calMap(me){
  const own=peranOf(me)==='karyawan'?me.id:null;const m={},seen=new Set();
  const add=(t,k,j,st)=>{(m[t]=m[t]||[]).push({k:k,j:j,st:st});};
  visA(me).forEach(a=>{if(!JENIS[a.status])return;if(own&&a.karyawanId!==own)return;seen.add(a.karyawanId+'_'+a.tanggal);add(a.tanggal,a.karyawanId,a.status,'disetujui');});
  visP(me).forEach(p=>{if(!isMenunggu(p))return;if(own&&p.karyawanId!==own)return;rangeDays(p.mulai,p.selesai).forEach(t=>{if(!seen.has(p.karyawanId+'_'+t))add(t,p.karyawanId,p.jenis,'menunggu');});});
  return m;
}
function tabKalender(me){
  const ym=ui.cal.ym;const y=+ym.slice(0,4),mo=+ym.slice(5,7);
  const first=parse(ym+'-01');const off=(first.getDay()+6)%7;const n=new Date(y,mo,0).getDate();
  const map=calMap(me);const t=todayStr();
  let cells='';for(let i=0;i<off;i++)cells+='<div class="cell blank"></div>';
  for(let d=1;d<=n;d++){
    const ds=ym+'-'+pad(d);const es=map[ds]||[];const dow=(off+d-1)%7;
    const keys=[];es.forEach(e=>{const k=e.j+'|'+e.st;if(keys.indexOf(k)<0)keys.push(k);});
    const dots=keys.slice(0,4).map(k=>{const a=k.split('|');return '<i class="dot '+a[0]+' '+a[1]+'"></i>';}).join('');
    cells+='<button type="button" class="cell'+(dow>=5?' we':'')+(ds===t?' today':'')+(ds===ui.cal.sel?' sel':'')+'" data-act="cal-day" data-d="'+ds+'" aria-label="'+d+' '+esc(namaBulan(ym))+(es.length?', '+es.length+' tidak masuk':'')+'"><span class="d">'+d+'</span>'+(es.length?'<span class="dots">'+dots+'</span><em>'+es.length+'</em>':'')+'</button>';
  }
  const sel=ui.cal.sel&&ui.cal.sel.slice(0,7)===ym?ui.cal.sel:null;
  let detail='';
  if(sel){
    const es=(map[sel]||[]).slice().sort((a,b)=>nameOf(a.k).localeCompare(nameOf(b.k),'id'));
    detail='<div class="panel" style="box-shadow:none"><h3>'+esc(fmtTgl(sel,{weekday:'long',day:'numeric',month:'long',year:'numeric'}))+'</h3>'+
      (es.length?'<div class="list">'+es.map(e=>{const k=byId(S.karyawan,e.k);return '<div class="req-h">'+avatar(k,1)+'<div class="nm"><b>'+esc(nameOf(e.k))+'</b><small>'+esc(k?jabNama(k):'')+'</small></div>'+chipJenis(e.j)+(e.st==='menunggu'?'<span class="chip menunggu">Menunggu</span>':'')+'</div>';}).join('')+'</div>':'<p class="sub">Tidak ada yang izin atau cuti.</p>')+'</div>';
  }
  return '<section class="panel"><div class="calhead"><button class="btn sm" type="button" data-act="cal-prev" aria-label="Bulan sebelumnya">'+icon('left',18)+'</button><h3>'+esc(namaBulan(ym))+'</h3><div class="row-act"><button class="btn sm ghost" type="button" data-act="cal-today">Hari ini</button><button class="btn sm" type="button" data-act="cal-next" aria-label="Bulan berikutnya">'+icon('right',18)+'</button></div></div>'+
    '<div class="legend"><span><i class="dot sakit"></i>Sakit</span><span><i class="dot cuti"></i>Cuti</span><span><i class="dot izin"></i>Izin</span><span><i class="dot menunggu cuti"></i>Menunggu keputusan</span></div>'+
    '<div class="calgrid">'+['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(x=>'<div class="dow">'+x+'</div>').join('')+cells+'</div></section>'+detail;
}

/* ---------- admin ---------- */
function scopeBanner(me){
  const s=scopeOf(me);
  if(!s)return '<p class="scope">Hak akses: <b>Super Admin</b> · semua departemen</p>';
  return '<p class="scope">Hak akses: <b>Admin</b> · '+(s.length?s.map(d=>'<span class="chip plain">'+esc(d)+'</span>').join(' '):'belum ada departemen yang diberikan. Hubungi Super Admin.')+'</p>';
}
function tabRingkasan(me){
  const t=todayStr();const ym=t.slice(0,7);
  const PP=visP(me),AA=visA(me);
  const pendRaw=PP.filter(isMenunggu);
  const pend=pendRaw.slice().sort(cmpMulai(1));
  const tuaInput=pendRaw.slice().sort((a,b)=>String(a.diajukanPada).localeCompare(String(b.diajukanPada)))[0];
  const hariIni=AA.filter(a=>a.tanggal===t&&JENIS[a.status]);
  const bln=s=>PP.filter(p=>p.status===s&&String(p.diputuskanPada||'').slice(0,7)===ym).length;
  const oldest=tuaInput?minsAgo(tuaInput.diajukanPada):0;
  const tiles='<div class="tiles"><div class="tile'+(pend.length?' warn':'')+'"><span class="n">'+pend.length+'</span><span class="l">Menunggu keputusan'+(pend.length&&oldest>=30?' · terlama '+ago(tuaInput.diajukanPada).replace(' lalu',''):'')+'</span></div>'+
    '<div class="tile"><span class="n">'+hariIni.length+'</span><span class="l">Tidak masuk hari ini</span></div>'+
    '<div class="tile"><span class="n">'+bln('disetujui')+'</span><span class="l">Disetujui bulan ini</span></div>'+
    '<div class="tile"><span class="n">'+bln('ditolak')+'</span><span class="l">Ditolak bulan ini</span></div></div>';
  const wait='<section class="panel"><header><h2>Menunggu keputusan</h2></header>'+(pend.length?'<div class="list">'+pend.slice(0,8).map(p=>reqCard(p,'admin')).join('')+'</div>'+(pend.length>8?'<p class="hint">Dan '+(pend.length-8)+' lainnya di tab Pengajuan.</p>':''):emptyBox('Tidak ada pengajuan yang menunggu.'))+'</section>';
  const out='<section class="panel"><header><h2>Tidak masuk hari ini</h2><span class="sub">'+esc(fmtTgl(t,{weekday:'long',day:'numeric',month:'long'}))+'</span></header>'+
    (hariIni.length?'<div class="list">'+hariIni.map(a=>{const k=byId(S.karyawan,a.karyawanId);return '<div class="req-h">'+avatar(k,1)+'<div class="nm"><b>'+esc(nameOf(a.karyawanId))+'</b><small>'+esc(k?jabNama(k):'')+(k&&k.departemen?' · '+esc(k.departemen):'')+'</small></div>'+chipJenis(a.status)+'</div>';}).join('')+'</div>':emptyBox('Semua karyawan masuk.'))+'</section>';
  return tiles+'<div class="cols">'+wait+out+'</div>';
}
/* Departemen = teks sebelum tanda "-", Area = teks sesudahnya (contoh Produksi-OB: departemen PRODUKSI, area OB). Level 3/4 = MANAGEMENT. */
const DEP_URUT=['ADMINISTRASI','CMS','MANAGEMENT','NSID','PRODUKSI','SHE','Workshop & Logistic'];
const depHead=s=>String(s||'').split('-')[0].trim();
const depTail=s=>{const i=String(s||'').indexOf('-');return i<0?'':String(s).slice(i+1).trim().toUpperCase();};
const depCanon=h=>DEP_URUT.find(x=>norm(x)===norm(h))||'';
function depAreaOf(k){
  if(!k)return {dep:'',area:''};
  if(levelOf(k)>=3)return {dep:'MANAGEMENT',area:''};
  const d=deptEff(k);
  return {dep:depCanon(depHead(d)),area:depTail(d)};
}
const areaDari=dep=>{const o=[];DEPARTEMEN.forEach(x=>{if(x.indexOf('-')>=0&&depCanon(depHead(x))===dep){const t=depTail(x);if(t&&o.indexOf(t)<0)o.push(t);}});return o;};
const depPengajuan=p=>depAreaOf(byId(S.karyawan,p.karyawanId));
/* urut berdasarkan tanggal pelaksanaan (mulai); dir -1 = terbaru dulu, 1 = terdekat dulu */
const cmpMulai=dir=>(a,b)=>dir*String(a.mulai).localeCompare(String(b.mulai))||dir*String(a.diajukanPada).localeCompare(String(b.diajukanPada));
function tabPengajuan(me){
  const f=ui.filter;const dp=ui.dep;const ar=ui.area;
  const areas=dp!=='semua'?areaDari(dp):[];
  const urut=x=>{const i=DEP_URUT.indexOf(x);return i<0?99:i;};
  const list=visP(me).filter(p=>{if(!(f==='semua'||(f==='menunggu'?isMenunggu(p):p.status===f)))return false;const da=depPengajuan(p);if(dp!=='semua'&&da.dep!==dp)return false;if(ar!=='semua'&&da.area!==ar)return false;return true;})
    .sort((a,b)=>(urut(depPengajuan(a).dep)-urut(depPengajuan(b).dep))||cmpMulai(-1)(a,b));
  const depSel='<div class="field"><label for="f-dep">Departemen</label><select id="f-dep" data-l="dep"><option value="semua"'+(dp==='semua'?' selected':'')+'>Semua Departemen</option>'+DEP_URUT.map(x=>'<option value="'+esc(x)+'"'+(dp===x?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select></div>';
  const areaSel=areas.length?'<div class="field"><label for="f-area">Area</label><select id="f-area" data-l="area"><option value="semua"'+(ar==='semua'?' selected':'')+'>Semua Area</option>'+areas.map(x=>'<option value="'+esc(x)+'"'+(ar===x?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select></div>':'';
  const filt='<div class="grid2 keep" style="max-width:520px">'+depSel+areaSel+'</div>';
  const chips=['semua','menunggu','disetujui','ditolak','dibatalkan'].map(s=>'<button type="button" class="fchip" data-act="filter" data-f="'+s+'" aria-pressed="'+(f===s)+'">'+(s==='semua'?'Semua':STATUS[s])+'</button>').join('');
  return '<section class="panel"><header><h2>Semua pengajuan</h2></header>'+filt+'<div class="filters">'+chips+'</div>'+
    (list.length?'<div class="cols">'+list.slice(0,60).map(p=>reqCard(p,'admin')).join('')+'</div>'+(list.length>60?'<p class="hint">Menampilkan 60 pengajuan dari '+list.length+' (urut departemen, lalu tanggal pelaksanaan). Persempit dengan filter status, departemen, atau area.</p>':''):emptyBox('Tidak ada pengajuan.'))+'</section>';
}
function tabKaryawan(me){
  const q=norm(ui.search);
  const all=visK(me);
  const list=all.filter(k=>!q||norm(k.nama).includes(q)||String(k.nik).toLowerCase().includes(q)||norm(jabNama(k)).includes(q)||norm(k.departemen).includes(q)).sort(byNama);
  const shown=list.slice(0,ui.karLimit);
  const bisaTambah=peranOf(me)==='superadmin'||deptOpsi(me).length>0;
  const baris=k=>{
    const akses=peranOf(k)==='admin'?'<br><small>Akses: '+((k.aksesDepartemen||[]).length?esc(k.aksesDepartemen.join(', ')):'belum diatur')+'</small>':'';
    return '<div class="rw"><div class="a">'+avatar(k,1)+'<div class="nm"><b>'+esc(k.nama)+'</b><small class="mono">'+esc(k.nik)+'</small></div></div>'+
      '<div><span>'+esc(jabNama(k))+'</span><br>'+(k.departemen?'<small>'+esc(k.departemen)+'</small>':(levelOf(k)>=3?'<small>Lintas departemen</small>':'<small class="nodep">Departemen belum diatur</small>'))+'</div>'+
      '<div><span class="chip plain">'+PERAN[peranOf(k)]+'</span>'+(levelOf(k)>=0?' <span class="chip plain">L'+levelOf(k)+(manualLv(k)!=null?' manual':'')+'</span>':'')+(k.aktif===false?' <span class="chip dibatalkan">Nonaktif</span>':'')+akses+'</div>'+
      (canKar(me,k)?'<button class="btn sm" type="button" data-act="kar-edit" data-id="'+k.id+'">Ubah</button>':'<span></span>')+'</div>';
  };
  return '<section class="panel"><header><div><h2>Karyawan</h2><p class="sub">'+all.length+' karyawan dalam cakupan Anda. Peran mengikuti jabatan.</p></div>'+(bisaTambah?'<button class="btn primary" type="button" data-act="kar-new">'+icon('plus',18)+'Tambah</button>':'')+'</header>'+
    '<div class="field"><label class="sr" for="k-search">Cari karyawan</label><input type="text" id="k-search" data-l="search" value="'+esc(ui.search)+'" placeholder="Cari nama, NIK, jabatan, atau departemen"></div>'+
    (list.length?'<div class="rows">'+shown.map(baris).join('')+'</div>'+(list.length>shown.length?'<button class="btn block" type="button" data-act="kar-more">Tampilkan lebih banyak ('+shown.length+' dari '+list.length+')</button>':''):emptyBox('Tidak ada karyawan yang cocok.'))+'</section>';
}
function tabJabatan(me){
  const q=norm(ui.jabsearch);const sup=peranOf(me)==='superadmin';
  const list=S.jabatan.filter(j=>!q||norm(j.nama).includes(q)).sort((a,b)=>String(a.nama).localeCompare(String(b.nama),'id'));
  const kv=visK(me);
  return '<section class="panel"><header><div><h2>Jabatan</h2><p class="sub">'+S.jabatan.length+' jabatan. Jabatan menentukan peran. Pengawas bisa menyetujui pengajuan.</p></div><button class="btn primary" type="button" data-act="jab-new">'+icon('plus',18)+'Tambah</button></header>'+
    '<div class="field"><label class="sr" for="j-search">Cari jabatan</label><input type="text" id="j-search" data-l="jabsearch" value="'+esc(ui.jabsearch)+'" placeholder="Cari jabatan"></div>'+
    (list.length?'<div class="rows">'+list.map(j=>{const n=kv.filter(k=>k.jabatanId===j.id).length;const pr=peranJab(j);const edit=sup||(j.peran!=='admin'&&j.peran!=='superadmin');
      return '<div class="rw"><div class="a"><div class="nm"><b>'+esc(j.nama)+'</b><small>'+n+' karyawan</small></div></div><div><span class="chip '+(pr==='pengawas'?'':'plain')+'">'+PERAN[pr]+'</span></div><div class="hint">'+(pr==='pengawas'?'Level '+levelJab(j)+' · Dapat ACC / Tolak':j.peran==='superadmin'?'Akses semua departemen':j.peran==='admin'?'Akses sesuai departemen':'Mengajukan izin')+'</div>'+
      (edit?'<button class="btn sm" type="button" data-act="jab-edit" data-id="'+j.id+'">Ubah</button>':'<span></span>')+'</div>';}).join('')+'</div>':emptyBox('Tidak ada jabatan yang cocok.'))+'</section>';
}
function rekapBulan(ym,me){
  const pref=ym+'-';
  const rows=visK(me).filter(k=>k.aktif!==false&&!isAdminPeran(k)).sort(byNama).map(k=>({k:k,sakit:0,cuti:0,izin:0}));
  const idx={};rows.forEach(r=>idx[r.k.id]=r);
  S.absensi.forEach(a=>{if(String(a.tanggal).indexOf(pref)===0&&idx[a.karyawanId]&&JENIS[a.status])idx[a.karyawanId][a.status]++;});
  return rows;
}
function tabLaporan(me){
  const rek=rekapBulan(ui.lap,me);
  const tot=rek.reduce((a,r)=>({s:a.s+r.sakit,c:a.c+r.cuti,i:a.i+r.izin}),{s:0,c:0,i:0});
  return '<section class="panel"><header><div><h2>Laporan bulanan</h2><p class="sub">Rekap hari tidak masuk per karyawan, kalender, dan daftar pengajuan dalam satu file Excel. Isinya hanya departemen dalam cakupan Anda.</p></div></header>'+
    '<div class="grid2 keep"><div class="field"><label for="lap-ym">Bulan</label><input type="month" id="lap-ym" data-l="lap" value="'+esc(ui.lap)+'"></div>'+
    '<div class="field"><span class="lbl">&nbsp;</span><button class="btn primary" type="button" data-act="unduh"'+(typeof XLSX!=='undefined'?'':' disabled')+'>'+icon('download',18)+'Unduh Excel</button></div></div>'+
    (typeof XLSX!=='undefined'?'':'<p class="hint">Pustaka Excel gagal dimuat. Periksa koneksi lalu muat ulang halaman.</p>')+
    '<div class="tbl tall"><table><thead><tr><th>Nama</th><th>Jabatan</th><th>Departemen</th><th class="n">Sakit</th><th class="n">Cuti</th><th class="n">Izin</th><th class="n">Total</th></tr></thead><tbody>'+
    (rek.length?rek.map(r=>'<tr><td>'+esc(r.k.nama)+'</td><td>'+esc(jabNama(r.k))+'</td><td>'+esc(r.k.departemen||'—')+'</td><td class="n">'+r.sakit+'</td><td class="n">'+r.cuti+'</td><td class="n">'+r.izin+'</td><td class="n"><b>'+(r.sakit+r.cuti+r.izin)+'</b></td></tr>').join('')+
      '<tr><td colspan="3"><b>Total</b></td><td class="n"><b>'+tot.s+'</b></td><td class="n"><b>'+tot.c+'</b></td><td class="n"><b>'+tot.i+'</b></td><td class="n"><b>'+(tot.s+tot.c+tot.i)+'</b></td></tr>':'<tr><td colspan="7" class="muted">Belum ada karyawan dalam cakupan Anda.</td></tr>')+
    '</tbody></table></div></section>';
}
async function unduhExcel(){
  if(!DL&&!STANDALONE){toast('Unduhan tidak tersedia di tampilan ini.');return;}
  if(typeof XLSX==='undefined'){toast('Pustaka Excel gagal dimuat. Muat ulang halaman.');return;}
  const me=meUser();if(!me||!isAdminPeran(me))return;
  const ym=ui.lap;const y=+ym.slice(0,4),mo=+ym.slice(5,7);const n=new Date(y,mo,0).getDate();
  const first=ym+'-01',last=ym+'-'+pad(n);const rek=rekapBulan(ym,me);const sc=scopeOf(me);
  const wb=XLSX.utils.book_new();
  const a1=[['Laporan Izin Sakit dan Cuti Karyawan Lapangan — '+namaBulan(ym)],['Cakupan: '+(sc?(sc.length?sc.join(', '):'(tidak ada)'):'Semua departemen')],['No','NIK','Nama','Jabatan','Departemen','Sakit (hari)','Cuti (hari)','Izin (hari)','Total (hari)']];
  let ts=0,tc=0,ti=0;
  rek.forEach((r,i)=>{a1.push([i+1,String(r.k.nik),r.k.nama,jabNama(r.k),r.k.departemen||'',r.sakit,r.cuti,r.izin,r.sakit+r.cuti+r.izin]);ts+=r.sakit;tc+=r.cuti;ti+=r.izin;});
  a1.push(['','','Total','','',ts,tc,ti,ts+tc+ti]);
  const w1=XLSX.utils.aoa_to_sheet(a1);w1['!cols']=[{wch:5},{wch:13},{wch:28},{wch:30},{wch:20},{wch:12},{wch:12},{wch:12},{wch:12}];w1['!merges']=[{s:{r:0,c:0},e:{r:0,c:8}},{s:{r:1,c:0},e:{r:1,c:8}}];
  XLSX.utils.book_append_sheet(wb,w1,'Rekap');
  const dn=['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  const h1=['NIK','Nama','Jabatan','Departemen'],h2=['','','',''];
  for(let d=1;d<=n;d++){h1.push(d);h2.push(dn[new Date(y,mo-1,d).getDay()]);}
  h1.push('Total');h2.push('');
  const a2=[h1,h2];
  const cell={};S.absensi.forEach(a=>{if(JENIS[a.status])cell[a.karyawanId+'_'+a.tanggal]=JENIS[a.status].code;});
  rek.forEach(r=>{const row=[String(r.k.nik),r.k.nama,jabNama(r.k),r.k.departemen||''];let c=0;for(let d=1;d<=n;d++){const v=cell[r.k.id+'_'+ym+'-'+pad(d)]||'';if(v)c++;row.push(v);}row.push(c);a2.push(row);});
  a2.push([]);a2.push(['Keterangan: S = Sakit, C = Cuti, I = Izin']);
  const w2=XLSX.utils.aoa_to_sheet(a2);w2['!cols']=[{wch:13},{wch:28},{wch:26},{wch:20}].concat(Array.from({length:n},()=>({wch:4})),[{wch:7}]);
  XLSX.utils.book_append_sheet(wb,w2,'Kalender');
  const a3=[['No','Diajukan','NIK','Nama','Jabatan','Departemen','Jenis','Mulai','Selesai','Durasi (hari)','Alasan','Pengawas','Status','Diputuskan oleh','Waktu keputusan','Catatan']];
  visP(me).filter(p=>p.mulai<=last&&p.selesai>=first).sort((a,b)=>String(a.mulai).localeCompare(String(b.mulai))).forEach((p,i)=>{
    const k=byId(S.karyawan,p.karyawanId);
    a3.push([i+1,new Date(p.diajukanPada).toLocaleString('id-ID'),k?String(k.nik):'',k?k.nama:'',k?jabNama(k):'',k?(k.departemen||''):'',JENIS[p.jenis].label,p.mulai,p.selesai,p.durasi,p.alasan,nameOf(p.pengawasId),STATUS[p.status],p.diputuskanOleh?nameOf(p.diputuskanOleh):'',p.diputuskanPada?new Date(p.diputuskanPada).toLocaleString('id-ID'):'',p.catatan||'']);
  });
  const w3=XLSX.utils.aoa_to_sheet(a3);w3['!cols']=[{wch:5},{wch:18},{wch:13},{wch:26},{wch:26},{wch:20},{wch:14},{wch:12},{wch:12},{wch:12},{wch:40},{wch:24},{wch:12},{wch:24},{wch:18},{wch:30}];
  XLSX.utils.book_append_sheet(wb,w3,'Pengajuan');
  try{
    const fn='Laporan-Izin-Cuti-'+ym+'.xlsx';
    if(DL){const buf=XLSX.write(wb,{bookType:'xlsx',type:'array'});await DL.save({filename:fn,data:buf});}else{XLSX.writeFile(wb,fn);}
    toast('Laporan disimpan.');
  }catch(e){if(!e||e.code!=='declined')toast('Laporan gagal disimpan.');}
}

/* ---------- modal ---------- */
function modalView(){
  const m=ui.modal;if(!m)return '';
  const meA=meUser();const sup=!!meA&&peranOf(meA)==='superadmin';
  let inner='';
  if(m.type==='kar'){
    const d=mdraft;const j=byId(S.jabatan,d.jabatanId);
    const jabs=S.jabatan.filter(x=>sup||x.peran!=='superadmin'||x.id===d.jabatanId).sort((a,b)=>String(a.nama).localeCompare(String(b.nama),'id'));
    const deps=deptOpsi(meA);
    const aks=(j&&j.peran==='admin')?'<div class="field"><span class="lbl">Akses departemen <small>(admin hanya melihat data departemen yang dicentang)</small></span><div class="aks">'+deps.map((x,i)=>{const on=d.akses.indexOf(x)>=0;return '<label class="pk'+(on?' on':'')+'" for="ak-'+i+'"><input type="checkbox" id="ak-'+i+'" data-akses="'+esc(x)+'"'+(on?' checked':'')+'><span class="t"><b>'+esc(x)+'</b></span></label>';}).join('')+'</div></div>':'';
    inner='<header><h2 id="m-title">'+(d.id?'Ubah karyawan':'Tambah karyawan')+'</h2><button class="btn ghost sm" type="button" data-act="close-modal" aria-label="Tutup">'+icon('x',18)+'</button></header>'+
      '<form id="f-kar" class="list" novalidate><div class="field"><label for="m-nama">Nama lengkap</label><input type="text" id="m-nama" data-m="nama" value="'+esc(d.nama)+'" autocomplete="off"></div>'+
      '<div class="field"><label for="m-nik">NIK</label><input type="text" id="m-nik" data-m="nik" value="'+esc(d.nik)+'" autocomplete="off"></div>'+
      '<div class="field"><label for="m-jab">Jabatan</label><select id="m-jab" data-m="jabatanId"><option value="">Pilih jabatan</option>'+jabs.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===d.jabatanId?' selected':'')+'>'+esc(x.nama)+'</option>').join('')+'</select>'+
      '<span class="hint">'+(j?'Peran otomatis: <b>'+PERAN[peranJab(j)]+'</b>'+(peranJab(j)==='pengawas'?' (Level '+levelJab(j)+', dapat ACC dan Tolak)':j.peran==='superadmin'?' (akses semua departemen)':''):'Peran mengikuti jabatan yang dipilih.')+'</span></div>'+
      (sup?'<div class="field"><label for="m-lvl">Tingkatan (level) <small class="muted">(Super Admin)</small></label><select id="m-lvl" data-m="level"><option value="">Otomatis dari jabatan</option>'+[0,1,2,3,4].map(l=>'<option value="'+l+'"'+(String(d.level)===String(l)?' selected':'')+'>Level '+l+' · '+esc(LV_NAMA[l])+'</option>').join('')+'</select></div>':'')+
      '<div class="grid2 keep"><div class="field"><label for="m-dep">Departemen</label><select id="m-dep" data-m="departemen"><option value="">Pilih departemen</option>'+deps.map(x=>'<option value="'+esc(x)+'"'+(x===d.departemen?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="m-kuota">Kuota cuti (hari/tahun)</label><input type="number" id="m-kuota" data-m="kuota" value="'+esc(d.kuota)+'" min="0" max="60"></div></div>'+
      aks+
      '<label class="pk'+(d.aktif?' on':'')+'" style="cursor:pointer"><input type="checkbox" data-m="aktif"'+(d.aktif?' checked':'')+'><span class="t"><b>Karyawan aktif</b><small>Nonaktif tidak bisa masuk, riwayat tetap tersimpan</small></span></label>'+
      (d.err?'<p class="err" role="alert">'+esc(d.err)+'</p>':'')+
      '<button class="btn primary block" type="submit">Simpan</button></form>';
  }else if(m.type==='jab'){
    const d=mdraft;const opsi=sup?['karyawan','pengawas','admin','superadmin']:['karyawan','pengawas'];
    inner='<header><h2 id="m-title">'+(d.id?'Ubah jabatan':'Tambah jabatan')+'</h2><button class="btn ghost sm" type="button" data-act="close-modal" aria-label="Tutup">'+icon('x',18)+'</button></header>'+
      '<form id="f-jab" class="list" novalidate><div class="field"><label for="m-jn">Nama jabatan</label><input type="text" id="m-jn" data-m="nama" value="'+esc(d.nama)+'" placeholder="Contoh: Mekanik" autocomplete="off"></div>'+
      '<div class="field"><span class="lbl">Peran</span><div class="seg" style="grid-template-columns:repeat(2,1fr)" role="radiogroup" aria-label="Peran">'+opsi.map(r=>'<label class="'+(d.peran===r?'on':'')+'"><input type="radio" name="peran" value="'+r+'" data-m="peran"'+(d.peran===r?' checked':'')+'>'+PERAN[r]+'</label>').join('')+'</div>'+
      '<span class="hint">Pengawas menerima notifikasi dan wajib ACC atau Tolak. Admin melihat data departemen yang diberikan. Super Admin melihat semua departemen.'+(sup?'':' Peran Admin dan Super Admin hanya bisa diatur oleh Super Admin.')+'</span></div>'+
      (d.err?'<p class="err" role="alert">'+esc(d.err)+'</p>':'')+
      '<div class="row-act"><button class="btn primary" type="submit" style="flex:1">Simpan</button>'+(d.id?'<button class="btn bad-o" type="button" data-act="jab-del">Hapus</button>':'')+'</div></form>';
  }else if(m.type==='lamp'){
    let body='<p class="sub">Memuat lampiran…</p>';
    if(m.missing)body='<p class="sub">Lampiran tidak ditemukan.</p>';
    else if(m.data){
      const d=m.data;
      body=(/^image\//.test(d.tipe)?'<div class="viewer"><img alt="Lampiran '+esc(d.nama)+'" src="'+d.dataUrl+'"></div>':'<div class="file"><span class="fx">'+icon('file',22)+'</span><div class="meta"><b>'+esc(d.nama)+'</b><small class="muted">PDF · '+fmtSize(d.ukuran)+'</small></div></div>')+
        '<div class="row-act"><span class="hint" style="flex:1">'+esc(d.nama)+' · '+fmtSize(d.ukuran)+'</span>'+((DL||STANDALONE)?'<button class="btn sm" type="button" data-act="lamp-dl">'+icon('download',16)+'Simpan file</button>':'')+'</div>';
    }
    inner='<header><h2 id="m-title">Lampiran</h2><button class="btn ghost sm" type="button" data-act="close-modal" aria-label="Tutup">'+icon('x',18)+'</button></header>'+body;
  }else if(m.type==='import'&&sup&&m.plan){
    const pl=m.plan;
    inner='<header><h2 id="m-title">Konfirmasi import</h2><button class="btn ghost sm" type="button" data-act="close-modal" aria-label="Tutup">'+icon('x',18)+'</button></header>'+
      '<p class="sub">'+esc(m.name)+'</p>'+
      '<div class="tiles"><div class="tile"><span class="n">'+pl.kar.length+'</span><span class="l">Karyawan</span></div><div class="tile"><span class="n">'+pl.jab.length+'</span><span class="l">Jabatan</span></div><div class="tile"><span class="n">'+pl.peng.length+'</span><span class="l">Pengajuan</span></div></div>'+
      '<div class="note warn"><b>Data lama akan ditimpa.</b> Karyawan dan jabatan yang tidak ada di file dihapus. Seluruh pengajuan, absensi, dan lampiran lama diganti dengan isi file.</div>'+
      (pl.warn.length?'<div class="note">'+pl.warn.map(esc).join('<br>')+'</div>':'')+
      (m.err?'<p class="err" role="alert">'+esc(m.err)+'</p>':'')+
      '<div class="row-act"><button class="btn primary" type="button" data-act="imp-apply" style="flex:1"'+(m.busy?' disabled':'')+'>'+(m.busy?'Mengimpor… jangan tutup halaman':'Timpa Data')+'</button><button class="btn" type="button" data-act="close-modal"'+(m.busy?' disabled':'')+'>Batal</button></div>';
  }
  if(!inner)inner=modalViewExtra(m);
  return '<div class="scrim" data-act="close-modal"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="m-title">'+inner+'</div></div>';
}

/* ---------- data awal ---------- */
const SEED=window.SEED_DATA||{dep:[],jab:[],rows:[]};
const DEF_JAB=[['jab-super','Super Admin','superadmin'],['jab-admin','Admin','admin'],['jab-sup','Supervisor','pengawas'],['jab-for','Foreman','pengawas'],['jab-off','Safety Officer','pengawas'],['jab-supt','Superintendent','pengawas'],['jab-ccr','CCR','karyawan'],['jab-opr','Operator','karyawan'],['jab-help','Helper Produksi','karyawan']];
async function seedDemo(){
  if(ui.seeding)return;
  const T=todayStr();const now=Date.now();
  ui.seeding='…';scheduleRender();
  try{
    /* jabatan: Super Admin, Admin, lalu semua jabatan dari Excel */
    const jab=[['jab-super',{nama:'Super Admin',peran:'superadmin'}],['jab-admin',{nama:'Admin',peran:'admin'}]];
    SEED.jab.forEach((j,i)=>jab.push(['j'+(i+1),{nama:j[0],peran:peranByNama(j[0],j[1])}]));
    const peranJabMap={};jab.forEach(j=>peranJabMap[j[0]]=j[1].peran);
    await bulk('jabatan',jab);
    /* 5 akun pengelola */
    const ALL=SEED.dep.slice();
    const MGR=[['k-super','SA-001','Super Admin','jab-super','',[]],
      ['k-adm1','ADM-001','Admin 1','jab-admin','Produksi-SMD',['Produksi-SMD']],
      ['k-adm2','ADM-002','Admin 2','jab-admin','Produksi-OB',['Produksi-OB']],
      ['k-adm3','ADM-003','Admin 3','jab-admin','Produksi-CH',['Produksi-CH']],
      ['k-adm4','ADM-004','Admin 4','jab-admin','Administrasi',['Administrasi','CMS','NSID','Produksi-SMC','SHE','Workshop & Logistic']]];
    const kar=MGR.map(m=>[m[0],{nik:m[1],nama:m[2],jabatanId:m[3],departemen:m[4],aksesDepartemen:m[5],kuotaCuti:12,aktif:true,dilokasi:false,demo:true}]);
    /* karyawan dari Excel */
    const emp=[];
    SEED.rows.forEach((r,i)=>{const o=['k'+(i+1),{nik:r[1],nama:r[0],jabatanId:'j'+(r[2]+1),departemen:r[3]>=0?ALL[r[3]]:'',aksesDepartemen:[],kuotaCuti:12,aktif:true,dilokasi:false}];emp.push(o);kar.push(o);});
    /* contoh pengajuan: karyawan dan pengawas dipilih dari departemen yang sama */
    const used=new Set();
    const jn={};jab.forEach(j=>jn[j[0]]=j[1].nama);
    const lvl=x=>levelByNama(jn[x[1].jabatanId]);
    const dEff=x=>deptEffNama(jn[x[1].jabatanId],x[1].departemen);
    const pilihKar=dep=>emp.find(x=>x[1].departemen===dep&&lvl(x)===0&&!used.has(x[0]));
    const pilihPeng=dep=>emp.find(x=>lvl(x)===1&&dEff(x)===dep);
    const pilihAtas=dep=>emp.find(x=>lvl(x)===2&&dEff(x)===dep);
    const P=[['p1','Produksi-SMD','sakit',0,1,'Demam dan sakit kepala sejak semalam','menunggu_tahap1',4,'',true],
      ['p2','Produksi-OB','cuti',3,5,'Acara keluarga di kampung','menunggu_tahap2',18,'',false],
      ['p3','Produksi-CH','izin',0,0,'Mengurus dokumen di kantor kecamatan','menunggu_tahap1',42,'',false],
      ['p4','Produksi-SMC','sakit',-2,-1,'Sakit perut, istirahat sesuai anjuran dokter','disetujui',3000,'Semoga lekas sembuh',true],
      ['p5','Workshop & Logistic','cuti',-10,-8,'Menghadiri pernikahan saudara','disetujui',17000,'',false],
      ['p6','SHE','izin',-5,-5,'Keperluan keluarga','ditolak',8600,'Produksi sedang padat, jadwalkan ulang',false],
      ['p7','Administrasi','cuti',7,9,'Cuti tahunan','disetujui',4300,'',false],
      ['p8','Produksi-SMD','sakit',-4,-4,'Flu dan batuk','disetujui',7200,'',true]];
    const svg=encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#fff"/><rect x="30" y="30" width="540" height="740" fill="none" stroke="#9fb3d9" stroke-width="3"/><text x="300" y="110" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="700" fill="#1a2a4a">SURAT KETERANGAN SAKIT</text><text x="300" y="150" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#6a7a99">(contoh data demo)</text><rect x="80" y="220" width="440" height="12" fill="#dfe6f3"/><rect x="80" y="260" width="380" height="12" fill="#dfe6f3"/><rect x="80" y="300" width="420" height="12" fill="#dfe6f3"/><rect x="80" y="340" width="300" height="12" fill="#dfe6f3"/><text x="440" y="680" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#6a7a99">dr. (contoh)</text></svg>');
    const lamp={nama:'surat-sakit-contoh.svg',tipe:'image/svg+xml',ukuran:1800,dataUrl:'data:image/svg+xml;charset=utf-8,'+svg};
    const peng=[],lamps=[],abs=[];
    P.forEach((p,i)=>{
      const k=pilihKar(p[1]),w=pilihPeng(p[1]);if(!k||!w)return;
      const a=pilihAtas(p[1]);
      used.add(k[0]);
      if(i<3){k[1].demo=true;w[1].demo=true;w[1].dilokasi=true;if(a&&p[6]==='menunggu_tahap2')a[1].demo=true;}
      const mulai=addDays(T,p[3]),selesai=addDays(T,p[4]),dec=p[6]==='disetujui'||p[6]==='ditolak';
      if(p[9])lamps.push(['l-'+p[0],lamp]);
      peng.push([p[0],{karyawanId:k[0],pengawasId:w[0],jenis:p[2],mulai:mulai,selesai:selesai,durasi:diffDays(mulai,selesai),alasan:p[5],lampiranId:p[9]?'l-'+p[0]:null,status:p[6],catatan:p[8],
        diajukanPada:new Date(now-p[7]*60000).toISOString(),diputuskanPada:dec?new Date(now-p[7]*60000+600000).toISOString():null,diputuskanOleh:dec?(a||w)[0]:null,
        approver_tahap1:w[0],levelPemohon:0,tahap_selanjutnya:2,deptTahap2:dEff(k),diputuskanTahap1:p[6]==='menunggu_tahap1'?null:w[0],diputuskanTahap1Pada:p[6]==='menunggu_tahap1'?null:new Date(now-p[7]*60000+300000).toISOString()}]);
      if(p[6]==='disetujui')rangeDays(mulai,selesai).forEach(t=>abs.push([k[0]+'_'+t,{karyawanId:k[0],tanggal:t,status:p[2],pengajuanId:p[0],sumber:'sistem'}]));
    });
    await bulk('karyawan',kar);
    for(const l of lamps)await put('lampiran',l[0],l[1]);
    await bulk('pengajuan',peng);
    await bulk('absensi',abs);
    toast('Data contoh siap: '+emp.length+' karyawan dari Excel. Pilih akun demo untuk masuk.',{ms:7000});
  }catch(e){console.error(e);toast('Sebagian data contoh gagal disimpan. Muat ulang lalu coba lagi.');}
  ui.seeding='';scheduleRender();
}
async function buatAdminAwal(){
  const nama=ui.fa.nama.trim(),nik=ui.fa.nik.trim();
  if(!nama||!nik){ui.loginErr='Isi nama dan NIK Super Admin.';render();return;}
  ui.loginErr='';
  try{
    for(const j of DEF_JAB)await put('jabatan',j[0],{nama:j[1],peran:j[2]});
    await put('karyawan','k-'+uid(),{nik:nik,nama:nama,jabatanId:'jab-super',departemen:'',aksesDepartemen:[],kuotaCuti:12,aktif:true,dilokasi:false});
    ui.ln=nama;ui.lk=nik;toast('Super Admin dibuat. Masuk dengan nama dan NIK tadi.');
  }catch(e){ui.loginErr='Gagal membuat akun. Coba lagi.';}
  render();
}
/* ---------- render ---------- */
let raf=0,restored=false;
function scheduleRender(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;render();});}
function tryRestore(){
  if(restored||!ready.karyawan||!ready.jabatan)return;
  restored=true;
  try{const id=localStorage.getItem('izin_sesi_v2');if(id&&byId(S.karyawan,id))ui.sesi=id;}catch(e){}
}
function render(){
  tryRestore();
  const app=$('#app');if(!app)return;
  const act=document.activeElement;const fid=act&&act.id;let sel=null;
  try{if(fid&&act.selectionStart!=null)sel=[act.selectionStart,act.selectionEnd];}catch(e){}
  const sy=window.scrollY;const dlg0=$('.dlg');const ds=dlg0?dlg0.scrollTop:0;
  app.innerHTML=view();
  const dlg1=$('.dlg');if(dlg1&&ds)dlg1.scrollTop=ds;
  if(fid){const el=document.getElementById(fid);if(el){try{el.focus({preventScroll:true});if(sel)el.setSelectionRange(sel[0],sel[1]);}catch(e){}}}
  window.scrollTo(0,sy);
}

/* ---------- Super Admin: import Excel dan reset ---------- */
const isSuper=()=>{const me=meUser();return !!me&&peranOf(me)==='superadmin';};
const PERAN_OK=['karyawan','pengawas','admin','superadmin'];
const normKey=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]/g,'');
const cellStr=v=>String(v==null?'':v).trim();
function pickCol(row,names){for(const k in row){if(names.indexOf(normKey(k))>=0){const v=row[k];if(v!==''&&v!=null)return v;}}return '';}
function toYmd(v){
  if(v===''||v==null)return '';
  let o='';
  if(typeof v==='number'&&v>20000){const d=new Date(Math.round((v-25569)*86400000));o=d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());}
  else{
    const t=String(v).trim();let m=t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if(m)o=m[1]+'-'+pad(+m[2])+'-'+pad(+m[3]);
    else{m=t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);if(m)o=m[3]+'-'+pad(+m[2])+'-'+pad(+m[1]);}
  }
  return(o&&ymd(parse(o))===o)?o:'';
}
function buatRencanaImport(wb,me){
  const errs=[],warn=[];let nErr=0;
  const err=m=>{nErr++;if(errs.length<8)errs.push(m);};
  const sheet=nm=>{const n=wb.SheetNames.find(x=>normKey(x).indexOf(nm)>=0);return n?XLSX.utils.sheet_to_json(wb.Sheets[n],{defval:''}):null;};
  const rowsK=sheet('karyawan'),rowsJ=sheet('jabatan')||[],rowsP=sheet('pengajuan')||[];
  if(!rowsK||!rowsK.length)return {errs:['Sheet "Karyawan" tidak ditemukan atau kosong.'],warn:[]};
  const depMap={};DEPARTEMEN.forEach(d=>depMap[norm(d)]=d);
  const oldJab={};S.jabatan.forEach(j=>oldJab[norm(j.nama)]=j);
  const oldKar={};S.karyawan.forEach(k=>oldKar[String(k.nik)]=k);
  const jabMap={};
  const addJab=(nama,peran)=>{
    const key=norm(nama);if(!key)return null;
    if(jabMap[key])return jabMap[key];
    const old=oldJab[key];const pr=PERAN_OK.indexOf(peran)>=0?peran:(old&&PERAN_OK.indexOf(old.peran)>=0?old.peran:'karyawan');
    return jabMap[key]={id:old?old.id:'j-'+uid(),nama:cellStr(nama),peran:peranByNama(nama,pr)};
  };
  rowsJ.forEach(r=>{const n=cellStr(pickCol(r,['namajabatan','jabatan','nama']));if(n)addJab(n,normKey(pickCol(r,['peran','role'])));});
  const kar=[],nikMap={};
  rowsK.forEach((r,i)=>{
    const nik=cellStr(pickCol(r,['nik','nomorindukkaryawan'])),nama=cellStr(pickCol(r,['nama','namalengkap'])),jn=cellStr(pickCol(r,['jabatan','namajabatan']));
    if(!nik&&!nama&&!jn)return;
    const at='Karyawan baris '+(i+2)+': ';
    if(!nik||!nama||!jn){err(at+'NIK, Nama, dan Jabatan wajib diisi.');return;}
    if(nikMap[nik]){err(at+'NIK '+nik+' dobel di file.');return;}
    const j=addJab(jn,'');
    let dep=cellStr(pickCol(r,['departemen','dept']));
    if(dep){if(!depMap[norm(dep)]){err(at+'departemen "'+dep+'" tidak dikenal.');return;}dep=depMap[norm(dep)];}
    else if(j.peran!=='superadmin'&&levelJab(j)<3){err(at+'departemen wajib diisi.');return;}
    let akses=[];
    if(j.peran==='admin'){
      akses=cellStr(pickCol(r,['aksesdepartemen','akses'])).split(/[,;]/).map(x=>depMap[norm(x)]).filter(Boolean);
      if(!akses.length){err(at+'jabatan Admin butuh kolom Akses Departemen.');return;}
    }
    const kq=pickCol(r,['kuotacuti','kuota']);const kuota=kq===''?12:Number(kq);
    const av=normKey(pickCol(r,['aktif']));
    const old=oldKar[nik];
    nikMap[nik]=old?old.id:'k-'+uid();
    kar.push([nikMap[nik],{nik:nik,nama:nama,jabatanId:j.id,departemen:dep,aksesDepartemen:akses,kuotaCuti:isFinite(kuota)?kuota:12,aktif:['tidak','nonaktif','no','false','0','n'].indexOf(av)<0,dilokasi:old?!!old.dilokasi:false}]);
  });
  if(!kar.length&&!nErr)err('Tidak ada baris karyawan yang valid.');
  /* akun yang sedang login selalu dipertahankan */
  const meNik=String(me.nik);
  if(!nikMap[meNik]){
    const oj=byId(S.jabatan,me.jabatanId);
    const j=oj?(jabMap[norm(oj.nama)]||(jabMap[norm(oj.nama)]={id:oj.id,nama:oj.nama,peran:oj.peran})):null;
    const d=Object.assign({},me);delete d.id;if(j)d.jabatanId=j.id;
    nikMap[meNik]=me.id;kar.push([me.id,d]);
    warn.push('Akun Anda ('+me.nama+') tidak ada di file, jadi tetap dipertahankan.');
  }
  const jabAkhir=Object.keys(jabMap).map(k=>jabMap[k]);
  const meRow=kar.find(x=>x[0]===me.id);
  const meJab=meRow?jabAkhir.find(j=>j.id===meRow[1].jabatanId):null;
  if(!meJab||meJab.peran!=='superadmin')err('Import dibatalkan: akun Anda akan kehilangan peran Super Admin. Pastikan NIK '+meNik+' memakai jabatan Super Admin di file.');
  if(nErr>errs.length)errs.push('…dan '+(nErr-errs.length)+' kesalahan lain.');
  if(nErr)return {errs:errs,warn:warn};
  const peng=[],abs=new Map();let skip=0;
  rowsP.forEach(r=>{
    const nk=cellStr(pickCol(r,['nikkaryawan','nik','nikpemohon'])),np=cellStr(pickCol(r,['nikpengawas','pengawas']));
    const mulai=toYmd(pickCol(r,['mulai','tanggalmulai'])),selesai=toYmd(pickCol(r,['selesai','tanggalselesai']));
    if(!nk&&!np&&!mulai&&!selesai)return;
    const jr=normKey(pickCol(r,['jenis']));const jenis=jr.indexOf('sakit')>=0?'sakit':jr.indexOf('cuti')>=0?'cuti':jr.indexOf('izin')>=0?'izin':'';
    const kid=nikMap[nk],pid=nikMap[np];
    if(!kid||!pid||!jenis||!mulai||!selesai||selesai<mulai||diffDays(mulai,selesai)>366){skip++;return;}
    const sr=normKey(pickCol(r,['status']));const status=sr==='menunggutahap2'?'menunggu_tahap2':sr.indexOf('menunggu')===0?'menunggu_tahap1':(STATUS[sr]?sr:'menunggu_tahap1');
    const dj=toYmd(pickCol(r,['diajukan','diajukanpada','tanggalpengajuan']));
    const aj=dj?new Date(dj+'T08:00:00').toISOString():new Date().toISOString();
    const id='p-'+uid();const dec=status==='disetujui'||status==='ditolak';
    const kr=kar.find(x=>x[0]===kid),jb=jabAkhir.find(j=>j.id===kr[1].jabatanId),lv=levelJab(jb),rt=ruteAtasan(lv,deptEffNama(jb?jb.nama:'',kr[1].departemen));
    if(lv<0||lv>=4){skip++;return;}
    peng.push([id,{karyawanId:kid,pengawasId:pid,jenis:jenis,mulai:mulai,selesai:selesai,durasi:diffDays(mulai,selesai),alasan:cellStr(pickCol(r,['alasan']))||'-',lampiranId:null,status:status,catatan:cellStr(pickCol(r,['catatan'])),
      diajukanPada:aj,diputuskanPada:dec?aj:null,diputuskanOleh:dec?pid:null,
      approver_tahap1:pid,levelPemohon:lv,tahap_selanjutnya:rt.tahap_selanjutnya,deptTahap2:rt.deptTahap2,diputuskanTahap1:status==='menunggu_tahap2'?pid:null,diputuskanTahap1Pada:null}]);
    if(status==='disetujui')rangeDays(mulai,selesai).forEach(t=>abs.set(kid+'_'+t,{karyawanId:kid,tanggal:t,status:jenis,pengajuanId:id,sumber:'sistem'}));
  });
  if(skip)warn.push(skip+' baris pengajuan dilewati (NIK tidak dikenal, tanggal atau jenis tidak valid).');
  return {errs:[],warn:warn,kar:kar,jab:jabAkhir.map(j=>[j.id,{nama:j.nama,peran:j.peran}]),peng:peng,abs:Array.from(abs.entries())};
}
async function handleImport(inp){
  const f=inp.files&&inp.files[0];if(!f)return;
  const me=meUser();if(!me||peranOf(me)!=='superadmin')return;
  if(typeof XLSX==='undefined'){ui.impErr=['Pustaka Excel gagal dimuat. Muat ulang halaman.'];render();return;}
  ui.impErr=null;ui.impBusy=true;render();
  try{
    const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});
    const pl=buatRencanaImport(wb,me);
    if(pl.errs.length)ui.impErr=pl.errs;
    else ui.modal={type:'import',plan:pl,name:f.name,busy:false,err:''};
  }catch(e){console.error(e);ui.impErr=['File tidak bisa dibaca. Pastikan formatnya .xlsx.'];}
  ui.impBusy=false;render();
}
async function bulkDelete(col,ids){
  if(!ids.length)return;
  if(col==='lampiran'){
    if(DB){for(let i=0;i<ids.length;i+=10)await Promise.all(ids.slice(i,i+10).map(id=>DB.collection('lampiran').doc(id).delete()));}
    ids.forEach(id=>lampiranLocal.delete(id));persistLocal();return;
  }
  if(!DB){const set=new Set(ids);S[col]=S[col].filter(x=>!set.has(x.id));persistLocal();scheduleRender();return;}
  for(let i=0;i<ids.length;i+=10)await Promise.all(ids.slice(i,i+10).map(id=>DB.collection(col).doc(id).delete()));
}
async function semuaLampiranIds(){
  const ids=new Set();
  S.pengajuan.forEach(p=>{if(p.lampiranId)ids.add(p.lampiranId);});
  lampiranLocal.forEach((v,k)=>ids.add(k));
  if(DB){try{const c=DB.collection('lampiran');if(c&&typeof c.get==='function'){const sn=await c.get();(sn.docs||[]).forEach(d=>ids.add(d.id));}}catch(e){}}
  return Array.from(ids);
}
async function terapkanImport(){
  const m=ui.modal;if(!m||m.type!=='import'||!m.plan||m.busy||!isSuper())return;
  const pl=m.plan;m.busy=true;m.err='';render();
  try{
    const lamp=await semuaLampiranIds();
    const keepK=new Set(pl.kar.map(x=>x[0])),keepJ=new Set(pl.jab.map(x=>x[0]));
    const oldP=S.pengajuan.map(x=>x.id),oldA=S.absensi.map(x=>x.id);
    const delK=S.karyawan.filter(x=>!keepK.has(x.id)).map(x=>x.id),delJ=S.jabatan.filter(x=>!keepJ.has(x.id)).map(x=>x.id);
    await bulkDelete('pengajuan',oldP);await bulkDelete('absensi',oldA);await bulkDelete('lampiran',lamp);
    await bulk('jabatan',pl.jab);await bulk('karyawan',pl.kar);
    await bulkDelete('karyawan',delK);await bulkDelete('jabatan',delJ);
    await bulk('pengajuan',pl.peng);await bulk('absensi',pl.abs);
    ui.modal=null;toast('Import selesai: '+pl.kar.length+' karyawan, '+pl.jab.length+' jabatan, '+pl.peng.length+' pengajuan.',{ms:7000});
  }catch(e){console.error(e);m.busy=false;m.err='Import terhenti di tengah jalan. Periksa koneksi lalu ulangi import dengan file yang sama.';}
  render();
}
async function resetSemua(){
  const m=ui.modal;if(!m||m.type!=='reset'||m.busy||!isSuper())return;
  m.busy=true;m.err='';render();
  try{
    const lamp=await semuaLampiranIds();
    await bulkDelete('pengajuan',S.pengajuan.map(x=>x.id));
    await bulkDelete('absensi',S.absensi.map(x=>x.id));
    await bulkDelete('lampiran',lamp);
    await bulkDelete('jabatan',S.jabatan.map(x=>x.id));
    await bulkDelete('karyawan',S.karyawan.map(x=>x.id));
    COLS.forEach(c=>{S[c]=[];});lampiranLocal.clear();lastStatus.clear();
    try{localStorage.removeItem('izin_data_v2');localStorage.removeItem('izin_sesi_v2');}catch(e){}
    ui.sesi=null;ui.modal=null;ui.tab=null;draft=emptyDraft();render();
    setTimeout(()=>{try{location.reload();}catch(e){}},400);
  }catch(e){console.error(e);m.busy=false;m.err='Penghapusan terhenti di tengah jalan. Periksa koneksi lalu coba lagi.';render();}
}
async function unduhTemplate(){
  if(!isSuper())return;
  if(typeof XLSX==='undefined'){toast('Pustaka Excel gagal dimuat. Muat ulang halaman.');return;}
  if(!DL&&!STANDALONE){toast('Unduhan tidak tersedia di tampilan ini.');return;}
  const wb=XLSX.utils.book_new();
  const nikOf=id=>{const k=byId(S.karyawan,id);return k?String(k.nik):'';};
  const aj=[['Nama Jabatan','Peran']];S.jabatan.slice().sort((a,b)=>String(a.nama).localeCompare(String(b.nama),'id')).forEach(j=>aj.push([j.nama,j.peran]));
  const ak=[['NIK','Nama','Jabatan','Departemen','Akses Departemen','Kuota Cuti','Aktif']];
  S.karyawan.slice().sort(byNama).forEach(k=>ak.push([String(k.nik),k.nama,jabNama(k),k.departemen||'',(k.aksesDepartemen||[]).join(', '),k.kuotaCuti==null?12:k.kuotaCuti,k.aktif===false?'Tidak':'Ya']));
  const ap=[['NIK Karyawan','NIK Pengawas','Jenis','Mulai','Selesai','Alasan','Status','Catatan','Diajukan']];
  S.pengajuan.slice().sort((a,b)=>String(a.mulai).localeCompare(String(b.mulai))).forEach(p=>ap.push([nikOf(p.karyawanId),nikOf(p.pengawasId),p.jenis,p.mulai,p.selesai,p.alasan,p.status,p.catatan||'',p.diajukanPada?ymd(new Date(p.diajukanPada)):'']));
  const info=[['Petunjuk import'],['Sheet Karyawan wajib. Sheet Jabatan dan Pengajuan opsional.'],['Peran: karyawan, pengawas, admin, superadmin. Jabatan berisi Officer, Leader, Koordinator, Penanggung Jawab, atau Superintendent otomatis menjadi pengawas.'],['Departemen: '+DEPARTEMEN.join(', ')],['Akses Departemen hanya untuk jabatan Admin, pisahkan dengan koma.'],['Jenis: sakit, cuti, izin. Status: menunggu, disetujui, ditolak, dibatalkan. Tanggal: YYYY-MM-DD.'],['Pengajuan dihubungkan lewat NIK karyawan dan NIK pengawas (atasan Tahap 1). Status menunggu otomatis menjadi Menunggu Tahap 1; tulis menunggu_tahap2 jika Tahap 1 sudah disetujui.'],['Level jabatan: 0 karyawan, 1 Foreman/Supervisor/Leader/Officer, 2 Superintendent/Penanggung Jawab/Kabag/HC, 3 Deputy PM, 4 PJO. Alur: 0>1>2>3>4 tanpa lompat.']];
  [['Karyawan',ak,[13,28,30,20,28,11,8]],['Jabatan',aj,[34,12]],['Pengajuan',ap,[14,14,9,12,12,36,12,28,12]],['Petunjuk',info,[120]]].forEach(x=>{const w=XLSX.utils.aoa_to_sheet(x[1]);w['!cols']=x[2].map(n=>({wch:n}));XLSX.utils.book_append_sheet(wb,w,x[0]);});
  try{
    const fn='Format-Import-Izin-Lapangan.xlsx';
    if(DL){const buf=XLSX.write(wb,{bookType:'xlsx',type:'array'});await DL.save({filename:fn,data:buf});}else{XLSX.writeFile(wb,fn);}
    toast('File format disimpan.');
  }catch(e){if(!e||e.code!=='declined')toast('File gagal disimpan.');}
}
/* ---------- Sinkron Manpower dari Excel acuan ---------- */
const MP_MASTER='semuakaryawanaktif';
const mpClean=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
function depSuffix(jn){const n=String(jn).toUpperCase();return /\bSMD\b/.test(n)?'Produksi-SMD':/\bSMC\b/.test(n)?'Produksi-SMC':/\bCH\b/.test(n)?'Produksi-CH':/\bOB\b/.test(n)?'Produksi-OB':'';}
/* departemen dari nama sheet + jabatan. '?' = perlu dipilih Super Admin, '__global' = Level 3/4 lintas departemen */
function depManpower(sheet,jn){
  if(/\bHC\b/i.test(jn))return 'Administrasi';
  if(levelByNama(jn)>=3)return '__global';
  const sk=normKey(sheet);
  const hit=sk?DEPARTEMEN.find(d=>normKey(d)===sk):null;
  if(hit)return hit;
  return depSuffix(jn)||'?';
}
function bacaManpower(wb){
  const rows=new Map(),warn=[];let dup=0,bad=0;
  const names=wb.SheetNames;
  const urut=names.filter(n=>normKey(n)!==MP_MASTER).concat(names.filter(n=>normKey(n)===MP_MASTER));
  urut.forEach(sn=>{
    const master=normKey(sn)===MP_MASTER;
    XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''}).forEach(r=>{
      const nik=mpClean(pickCol(r,['nip','nik','nomorindukkaryawan'])),nama=mpClean(pickCol(r,['namalengkap','nama'])),jab=mpClean(pickCol(r,['jabatan','namajabatan'])).toUpperCase();
      if(!nik&&!nama&&!jab)return;
      if(!nik||!nama||!jab){bad++;return;}
      if(rows.has(nik)){if(!master)dup++;return;}
      rows.set(nik,{nik:nik,nama:nama,jab:jab,jabKey:norm(jab),bendera:mpClean(pickCol(r,['bendera','perusahaan'])),dep:depManpower(master?'':sn,jab)});
    });
  });
  if(bad)warn.push(bad+' baris tanpa NIP, nama, atau jabatan dilewati.');
  if(dup)warn.push(dup+' NIP muncul di lebih dari satu sheet departemen. Sheet pertama dipakai.');
  return {rows:Array.from(rows.values()),warn:warn};
}
function mpFinal(m){
  const pilih=m.pilih||{};
  const jabBy={};S.jabatan.forEach(j=>jabBy[norm(j.nama)]=j);
  const oldK={};S.karyawan.forEach(k=>oldK[String(k.nik)]=k);
  const unres={},rows=[],touched=new Set();
  m.rows.forEach(r=>{
    let dep=r.dep;touched.add(r.nik);
    if(dep==='?'){const c=pilih[r.jabKey];if(c==='__skip')return;if(!c){const u=unres[r.jabKey]||(unres[r.jabKey]={jab:r.jab,n:0});u.n++;return;}dep=c;}
    rows.push(Object.assign({},r,{dep:dep==='__global'?'':dep}));
  });
  const jabBaru={},kar=[],cnt={baru:0,ubah:0,sama:0,nonaktif:0},lv=[0,0,0,0,0],cov={},warn=[];
  rows.forEach(r=>{
    let j=jabBy[r.jabKey],L,jid;
    if(j){jid=j.id;L=levelJab(j);}
    else{const nj=jabBaru[r.jabKey]||(jabBaru[r.jabKey]={id:'j-'+uid(),nama:r.jab,peran:peranByNama(r.jab,'karyawan')});jid=nj.id;L=levelJab(nj);}
    if(L>=0){lv[L]++;const key=L>=3?'G|'+L:deptEffNama(r.jab,r.dep)+'|'+L;cov[key]=(cov[key]||0)+1;}
    const o=oldK[r.nik];
    const nama=o&&norm(o.nama)===norm(r.nama)?o.nama:r.nama;
    const data={nik:r.nik,nama:nama,jabatanId:jid,departemen:r.dep,bendera:r.bendera,aktif:true};
    if(!o){cnt.baru++;kar.push(['k-'+uid(),Object.assign({aksesDepartemen:[],kuotaCuti:12,dilokasi:false},data)]);}
    else if(o.nama!==nama||o.jabatanId!==jid||(o.departemen||'')!==r.dep||o.aktif===false||(o.bendera||'')!==r.bendera){
      cnt.ubah++;const c=Object.assign({},o);delete c.id;kar.push([o.id,Object.assign(c,data)]);
    }else cnt.sama++;
  });
  if(m.nonaktif!==false){
    const me=meUser();
    S.karyawan.forEach(k=>{
      if(touched.has(String(k.nik))||k.aktif===false||(me&&k.id===me.id))return;
      const pr=peranOf(k);if(pr==='admin'||pr==='superadmin')return;
      cnt.nonaktif++;const c=Object.assign({},k);delete c.id;c.aktif=false;kar.push([k.id,c]);
    });
  }
  DEPARTEMEN.forEach(d=>{
    if(!cov[d+'|0'])return;
    [1,2].forEach(l=>{if(!cov[d+'|'+l])warn.push(d+': belum ada Level '+l+' ('+LV_NAMA[l]+'). Pengajuan akan antre di level itu.');});
  });
  [3,4].forEach(l=>{if(!cov['G|'+l])warn.push('Belum ada '+LV_NAMA[l]+' (Level '+l+'). Pengajuan yang naik ke level ini akan antre.');});
  return {rows:rows,unres:unres,jabBaru:Object.keys(jabBaru).map(k=>jabBaru[k]),kar:kar,cnt:cnt,lv:lv,warn:warn,total:rows.length};
}
async function handleManpower(inp){
  const f=inp.files&&inp.files[0];if(!f||!isSuper())return;
  if(typeof XLSX==='undefined'){ui.mpErr=['Pustaka Excel gagal dimuat. Muat ulang halaman.'];render();return;}
  ui.mpErr=null;ui.mpBusy=true;render();
  try{
    const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});
    const r=bacaManpower(wb);
    if(!r.rows.length)ui.mpErr=['Tidak ada baris karyawan yang valid. Pastikan ada kolom NIP, NAMA LENGKAP, dan JABATAN.'];
    else ui.modal={type:'manpower',rows:r.rows,warn:r.warn,name:f.name,pilih:{},nonaktif:true,busy:false,err:''};
  }catch(e){console.error(e);ui.mpErr=['File tidak bisa dibaca. Pastikan formatnya .xlsx.'];}
  ui.mpBusy=false;render();
}
async function terapkanManpower(){
  const m=ui.modal;if(!m||m.type!=='manpower'||m.busy||!isSuper())return;
  const f=mpFinal(m);if(Object.keys(f.unres).length)return;
  m.busy=true;m.err='';render();
  try{
    await bulk('jabatan',f.jabBaru.map(j=>[j.id,{nama:j.nama,peran:j.peran}]));
    await bulk('karyawan',f.kar);
    ui.modal=null;toast('Sinkron selesai: '+f.cnt.baru+' baru, '+f.cnt.ubah+' diperbarui, '+f.cnt.nonaktif+' dinonaktifkan.',{ms:7000});
  }catch(e){console.error(e);m.busy=false;m.err='Sinkron terhenti di tengah jalan. Periksa koneksi lalu ulangi dengan file yang sama.';}
  render();
}
async function unduhManpower(){
  if(!isSuper())return;
  if(typeof XLSX==='undefined'){toast('Pustaka Excel gagal dimuat. Muat ulang halaman.');return;}
  if(!DL&&!STANDALONE){toast('Unduhan tidak tersedia di tampilan ini.');return;}
  const wb=XLSX.utils.book_new();
  const aktif=S.karyawan.filter(k=>k.aktif!==false&&!isAdminPeran(k)).sort(byNama);
  const mk=list=>{const a=[['NO','BENDERA','NAMA LENGKAP','NIP','JABATAN']];list.forEach((k,i)=>a.push([i+1,k.bendera||'',k.nama,String(k.nik),jabNama(k)]));return a;};
  const de=k=>deptEff(k);
  [['Semua Karyawan Aktif',aktif],['SHE',aktif.filter(k=>de(k)==='SHE')],['PRODUKSI',aktif.filter(k=>String(de(k)).indexOf('Produksi-')===0)],['ADMINISTRASI',aktif.filter(k=>de(k)==='Administrasi'&&levelOf(k)<3)],
   ['Workshop & Logistic',aktif.filter(k=>de(k)==='Workshop & Logistic')],['NSID',aktif.filter(k=>de(k)==='NSID')],['CMS',aktif.filter(k=>de(k)==='CMS')],['MANAGEMENT',aktif.filter(k=>levelOf(k)>=3)]].forEach(x=>{
    const w=XLSX.utils.aoa_to_sheet(mk(x[1]));w['!cols']=[{wch:5},{wch:18},{wch:34},{wch:14},{wch:36}];XLSX.utils.book_append_sheet(wb,w,x[0]);
  });
  try{
    const fn='Data-Manpower-'+todayStr()+'.xlsx';
    if(DL){const buf=XLSX.write(wb,{bookType:'xlsx',type:'array'});await DL.save({filename:fn,data:buf});}else{XLSX.writeFile(wb,fn);}
    toast('File manpower disimpan.');
  }catch(e){if(!e||e.code!=='declined')toast('File gagal disimpan.');}
}
function openApv(id){
  if(!isSuper())return;
  const k=id?byId(S.karyawan,id):null;
  mdraft=k?{id:k.id,nik:String(k.nik),nama:k.nama,jab:jabNama(k)==='—'?'':jabNama(k),departemen:k.departemen||'',level:manualLv(k)!=null?String(manualLv(k)):'',err:''}
          :{id:null,nik:'',nama:'',jab:'',departemen:'',level:'',err:''};
  ui.modal={type:'apv'};render();setTimeout(()=>{const e=$('#a-nik');if(e)e.focus();},30);
}
async function saveApv(){
  const d=mdraft;d.err='';const me=meUser();
  if(!me||peranOf(me)!=='superadmin')return;
  const nik=String(d.nik).trim(),nama=String(d.nama).trim(),jn=mpClean(d.jab).toUpperCase();
  const old=S.karyawan.find(k=>String(k.nik)===nik);
  let jab=S.jabatan.find(j=>norm(j.nama)===norm(jn));
  const eff=d.level!==''?Number(d.level):(jab?levelJab(jab):levelByNama(jn));
  const dep=eff>=3?'':(/\bHC\b/i.test(jn)?'Administrasi':d.departemen);
  if(!nik)d.err='Isi NIP.';
  else if(!nama)d.err='Isi nama lengkap.';
  else if(!jn)d.err='Isi jabatan.';
  else if(jab&&(jab.peran==='admin'||jab.peran==='superadmin'))d.err='Jabatan Admin dan Super Admin diatur lewat tab Karyawan.';
  else if(old&&isAdminPeran(old))d.err='Akun Admin dan Super Admin diatur lewat tab Karyawan.';
  else if(eff<3&&!dep)d.err='Pilih departemen.';
  if(d.err){render();return;}
  try{
    if(!jab){jab={id:'j-'+uid(),nama:jn,peran:eff>=1?'pengawas':'karyawan'};await put('jabatan',jab.id,{nama:jab.nama,peran:jab.peran});}
    const base=Object.assign({aksesDepartemen:[],kuotaCuti:12,dilokasi:false},old||{});delete base.id;
    await put('karyawan',old?old.id:'k-'+uid(),Object.assign(base,{nik:nik,nama:nama,jabatanId:jab.id,departemen:dep,aktif:true,levelManual:d.level!==''?Number(d.level):null}));
    ui.modal=null;toast(nama+' disimpan sebagai Level '+eff+(dep?' · '+dep:' · lintas departemen')+'.');
  }catch(e){console.error(e);d.err='Gagal menyimpan. Coba lagi.';}
  render();
}
function tabPengaturan(me){
  if(peranOf(me)!=='superadmin')return emptyBox('Menu ini hanya untuk Super Admin.');
  const tiles='<div class="tiles"><div class="tile"><span class="n">'+S.karyawan.length+'</span><span class="l">Karyawan</span></div><div class="tile"><span class="n">'+S.jabatan.length+'</span><span class="l">Jabatan</span></div><div class="tile"><span class="n">'+S.pengajuan.length+'</span><span class="l">Pengajuan</span></div></div>';
  const imp='<section class="panel"><header><div><h2>Import data Excel</h2><p class="sub">Unggah file .xlsx untuk memuat atau menimpa data karyawan, jabatan, dan pengajuan. Anda akan diminta konfirmasi sebelum data diganti.</p></div></header>'+
    '<div class="note">Sheet <b>Karyawan</b> wajib (NIK, Nama, Jabatan, Departemen). Sheet <b>Jabatan</b> dan <b>Pengajuan</b> opsional. Pakai tombol unduh di bawah untuk mendapat format yang tepat beserta data saat ini.</div>'+
    '<div class="row-act"><label class="btn primary" for="imp-file">'+icon('up',18)+(ui.impBusy?'Membaca file…':'Import Data Excel')+'</label><input type="file" id="imp-file" accept=".xlsx,.xls" class="sr" tabindex="-1">'+
    '<button class="btn" type="button" data-act="imp-template"'+(typeof XLSX!=='undefined'?'':' disabled')+'>'+icon('download',18)+'Unduh format dan data saat ini</button></div>'+
    (ui.impErr&&ui.impErr.length?'<div class="note bad" role="alert">'+ui.impErr.map(esc).join('<br>')+'</div>':'')+'</section>';
  const danger='<section class="panel" style="border-color:var(--bad)"><header><div><h2>Hapus semua data</h2><p class="sub">Menghapus karyawan, jabatan, pengajuan, absensi, dan lampiran secara permanen, termasuk akun Anda. Unduh data lebih dulu jika masih dibutuhkan.</p></div></header>'+
    '<div class="row-act"><button class="btn bad-o" type="button" data-act="reset-ask">'+icon('x',18)+'Hapus Semua Data</button></div></section>';
  const mp='<section class="panel"><header><div><h2>Sinkron manpower dari Excel</h2><p class="sub">Input otomatis karyawan dan jabatan dari file manpower acuan. Data lama tidak dihapus: karyawan baru ditambah, yang sudah ada diperbarui lewat NIP.</p></div></header>'+
    '<div class="note"><b>Format acuan:</b> kolom <b>NO, BENDERA, NAMA LENGKAP, NIP, JABATAN</b>. Departemen diambil dari nama sheet (SHE, ADMINISTRASI, Workshop &amp; Logistic, NSID, CMS). Sheet <b>PRODUKSI</b> dipecah lewat akhiran jabatan (SMD, SMC, CH, OB). Sheet <b>MANAGEMENT</b>: PJO dan Deputy PM lintas departemen, jabatan berunsur HC masuk Administrasi. Sheet <b>Semua Karyawan Aktif</b> dipakai sebagai cadangan. Level dan peran ditentukan otomatis dari nama jabatan.</div>'+
    '<div class="row-act"><label class="btn primary" for="mp-file">'+icon('up',18)+(ui.mpBusy?'Membaca file…':'Pilih file manpower')+'</label><input type="file" id="mp-file" accept=".xlsx,.xls" class="sr" tabindex="-1">'+
    '<button class="btn" type="button" data-act="mp-template"'+(typeof XLSX!=='undefined'?'':' disabled')+'>'+icon('download',18)+'Unduh format manpower saat ini</button></div>'+
    (ui.mpErr&&ui.mpErr.length?'<div class="note bad" role="alert">'+ui.mpErr.map(esc).join('<br>')+'</div>':'')+'</section>';
  const RULE={0:'Driver, CCR, Operator, Mekanik, Helper, dan lainnya',1:'Foreman, Supervisor, Leader, Officer, Koordinator',2:'Superintendent, Penanggung Jawab, Kabag, HC (masuk Administrasi)',3:'Deputy PM (lintas departemen)',4:'PJO (lintas departemen)'};
  const lvRows=[0,1,2,3,4].map(l=>'<tr><td>Level '+l+'</td><td>'+esc(RULE[l])+'</td><td class="n">'+S.jabatan.filter(j=>levelJab(j)===l).length+'</td><td class="n">'+S.karyawan.filter(k=>k.aktif!==false&&levelOf(k)===l).length+'</td></tr>').join('');
  const lvl='<section class="panel"><header><div><h2>Aturan level jabatan</h2><p class="sub">Alur persetujuan berjenjang 0 &gt; 1 &gt; 2 &gt; 3 &gt; 4 tanpa lompat. Level dibaca dari nama jabatan, jadi jabatan baru langsung mengikuti aturan ini.</p></div></header>'+
    '<div class="tbl"><table><thead><tr><th>Level</th><th>Jabatan</th><th class="n">Jabatan</th><th class="n">Karyawan aktif</th></tr></thead><tbody>'+lvRows+'</tbody></table></div></section>';
  const aq=norm(ui.apvsearch||'');
  const apvList=S.karyawan.filter(k=>k.aktif!==false&&levelOf(k)>=1&&(!aq||norm(k.nama).includes(aq)||String(k.nik).toLowerCase().includes(aq)||norm(jabNama(k)).includes(aq)||norm(deptEff(k)).includes(aq)))
    .sort((a,b)=>(levelOf(b)-levelOf(a))||String(deptEff(a)).localeCompare(String(deptEff(b)))||byNama(a,b));
  const apv='<section class="panel"><header><div><h2>Approver dan tingkatan</h2><p class="sub">Tambah karyawan yang bisa menyetujui, lalu atur level dan departemennya. Pengaturan ini menimpa level dari jabatan.</p></div><button class="btn primary" type="button" data-act="apv-new">'+icon('plus',18)+'Tambah approver</button></header>'+
    '<div class="field"><label class="sr" for="apv-search">Cari approver</label><input type="text" id="apv-search" data-l="apvsearch" value="'+esc(ui.apvsearch||'')+'" placeholder="Cari nama, NIP, jabatan, atau departemen"></div>'+
    '<div class="tbl tall"><table><thead><tr><th>Nama</th><th>NIP</th><th>Jabatan</th><th>Level</th><th>Departemen</th><th></th></tr></thead><tbody>'+
    (apvList.length?apvList.slice(0,300).map(k=>'<tr><td>'+esc(k.nama)+'</td><td class="mono">'+esc(k.nik)+'</td><td>'+esc(jabNama(k))+'</td><td><span class="chip plain">L'+levelOf(k)+(manualLv(k)!=null?' manual':'')+'</span></td><td>'+(levelOf(k)>=3?'Lintas departemen':esc(deptEff(k)||'—'))+'</td><td><button class="btn sm" type="button" data-act="apv-edit" data-id="'+esc(k.id)+'">Ubah</button></td></tr>').join(''):'<tr><td colspan="6" class="muted">Belum ada approver yang cocok.</td></tr>')+
    '</tbody></table></div></section>';
  return tiles+mp+apv+lvl+imp+danger;
}

/* ---------- modal simpan ---------- */
function openKar(id){
  const me=meUser();const k=id?byId(S.karyawan,id):null;
  if(k&&!canKar(me,k)){toast('Anda tidak punya akses ke karyawan ini.');return;}
  const deps=deptOpsi(me);
  mdraft=k?{id:k.id,nama:k.nama,nik:String(k.nik),jabatanId:k.jabatanId||'',departemen:k.departemen||'',akses:(k.aksesDepartemen||[]).slice(),kuota:k.kuotaCuti==null?12:k.kuotaCuti,aktif:k.aktif!==false,err:''}
          :{id:null,nama:'',nik:'',jabatanId:'',departemen:deps.length===1?deps[0]:'',akses:[],kuota:12,aktif:true,err:''};
  mdraft.level=(k&&k.levelManual!=null)?String(k.levelManual):'';
  ui.modal={type:'kar'};render();setTimeout(()=>{const e=$('#m-nama');if(e)e.focus();},30);
}
function openJab(id){
  const me=meUser();const j=id?byId(S.jabatan,id):null;
  if(j&&(j.peran==='admin'||j.peran==='superadmin')&&peranOf(me)!=='superadmin'){toast('Hanya Super Admin yang bisa mengubah jabatan ini.');return;}
  mdraft=j?{id:j.id,nama:j.nama,peran:j.peran,err:''}:{id:null,nama:'',peran:'karyawan',err:''};
  ui.modal={type:'jab'};render();setTimeout(()=>{const e=$('#m-jn');if(e)e.focus();},30);
}
async function saveKar(){
  const d=mdraft;d.err='';const me=meUser();
  const sup=!!me&&peranOf(me)==='superadmin';const opsi=deptOpsi(me);
  const nama=d.nama.trim(),nik=d.nik.trim();
  const j=byId(S.jabatan,d.jabatanId);const old=d.id?byId(S.karyawan,d.id):null;
  if(!me||!isAdminPeran(me))d.err='Hanya admin yang bisa mengubah data karyawan.';
  else if(old&&!canKar(me,old))d.err='Anda tidak punya akses ke karyawan ini.';
  else if(!nama)d.err='Isi nama lengkap.';
  else if(!nik)d.err='Isi NIK.';
  else if(S.karyawan.some(k=>k.id!==d.id&&String(k.nik)===nik))d.err='NIK sudah dipakai karyawan lain.';
  else if(!j)d.err='Pilih jabatan.';
  else if(j.peran==='superadmin'&&!sup)d.err='Hanya Super Admin yang bisa memberi jabatan Super Admin.';
  else if(j.peran!=='superadmin'&&(sup&&d.level!==''?Number(d.level):levelJab(j))<3&&!d.departemen)d.err='Pilih departemen.';
  else if(d.departemen&&opsi.indexOf(d.departemen)<0)d.err='Departemen di luar hak akses Anda.';
  else if(j.peran==='admin'&&!d.akses.length)d.err='Pilih minimal satu departemen untuk akses admin.';
  else if(j.peran==='admin'&&d.akses.some(x=>opsi.indexOf(x)<0))d.err='Akses departemen di luar hak akses Anda.';
  else if(old&&d.id===ui.sesi&&d.aktif===false)d.err='Anda tidak bisa menonaktifkan akun sendiri.';
  else if(old&&d.id===ui.sesi&&peranOf(old)!==j.peran)d.err='Anda tidak bisa mengubah peran akun sendiri.';
  if(d.err){render();return;}
  const data=Object.assign({},old||{},{nik:nik,nama:nama,jabatanId:d.jabatanId,departemen:d.departemen||'',aksesDepartemen:j.peran==='admin'?d.akses.slice():[],kuotaCuti:Number(d.kuota)||0,aktif:!!d.aktif,dilokasi:old?!!old.dilokasi:false,levelManual:sup?(d.level!==''?Number(d.level):null):(old&&old.levelManual!=null?old.levelManual:null)});delete data.id;
  if(old&&old.demo)data.demo=true;
  try{await put('karyawan',d.id||'k-'+uid(),data);ui.modal=null;toast(old?'Data karyawan disimpan.':'Karyawan ditambahkan.');}catch(e){console.error(e);d.err='Gagal menyimpan. Coba lagi.';}
  render();
}
async function saveJab(){
  const d=mdraft;d.err='';const me=meUser();const sup=!!me&&peranOf(me)==='superadmin';
  const nama=d.nama.trim();const old=d.id?byId(S.jabatan,d.id):null;
  if(!me||!isAdminPeran(me))d.err='Hanya admin yang bisa mengubah jabatan.';
  else if(!nama)d.err='Isi nama jabatan.';
  else if(S.jabatan.some(j=>j.id!==d.id&&norm(j.nama)===norm(nama)))d.err='Nama jabatan sudah ada.';
  else if(!sup&&(d.peran==='admin'||d.peran==='superadmin'))d.err='Hanya Super Admin yang bisa memberi peran Admin atau Super Admin.';
  else if(old&&!sup&&(old.peran==='admin'||old.peran==='superadmin'))d.err='Hanya Super Admin yang bisa mengubah jabatan ini.';
  else if(old&&me.jabatanId===d.id&&old.peran!==d.peran)d.err='Peran jabatan Anda sendiri tidak bisa diubah.';
  if(d.err){render();return;}
  try{await put('jabatan',d.id||'j-'+uid(),{nama:nama,peran:peranByNama(nama,d.peran)});ui.modal=null;toast('Jabatan disimpan.');}catch(e){console.error(e);d.err='Gagal menyimpan. Coba lagi.';}
  render();
}
async function hapusJab(){
  const d=mdraft;const me=meUser();const old=byId(S.jabatan,d.id);
  const n=S.karyawan.filter(k=>k.jabatanId===d.id).length;
  if(old&&(old.peran==='admin'||old.peran==='superadmin')&&peranOf(me)!=='superadmin'){d.err='Hanya Super Admin yang bisa menghapus jabatan ini.';render();return;}
  if(n){d.err='Masih dipakai '+n+' karyawan. Pindahkan dulu jabatan mereka.';render();return;}
  try{await remove('jabatan',d.id);ui.modal=null;toast('Jabatan dihapus.');}catch(e){d.err='Gagal menghapus.';}
  render();
}
function openLamp(lid){
  ui.modal={type:'lamp',lid:lid,data:null,missing:false};render();
  getLampiran(lid).then(d=>{if(ui.modal&&ui.modal.lid===lid){if(d)ui.modal.data=d;else ui.modal.missing=true;render();}}).catch(()=>{if(ui.modal&&ui.modal.lid===lid){ui.modal.missing=true;render();}});
}

/* ---------- peristiwa ---------- */
function setPath(path,val){
  const a=path.split('.');if(a.length===2)ui[a[0]][a[1]]=val;else ui[a[0]]=val;
}
function onField(e){
  const t=e.target;
  if(t.id==='f-file'){if(e.type==='change')handleFile(t);return;}
  if(t.id==='imp-file'){if(e.type==='change')handleImport(t);return;}
  if(t.id==='mp-file'){if(e.type==='change')handleManpower(t);return;}
  if(t.dataset.reassign){if(e.type==='change')reassign(t.dataset.reassign,t.value);return;}
  if(t.dataset.mp!==undefined){if(ui.modal&&ui.modal.type==='manpower'){ui.modal.pilih=ui.modal.pilih||{};ui.modal.pilih[t.dataset.mp]=t.value;if(e.type==='change')render();}return;}
  if(t.dataset.mpopt!==undefined){if(ui.modal&&ui.modal.type==='manpower'){ui.modal.nonaktif=t.checked;if(e.type==='change')render();}return;}
  if(t.dataset.akses!==undefined){
    const dep=t.dataset.akses;const i=mdraft.akses.indexOf(dep);
    if(t.checked&&i<0)mdraft.akses.push(dep);
    if(!t.checked&&i>=0)mdraft.akses.splice(i,1);
    if(e.type==='change')render();
    return;
  }
  if(t.dataset.l){
    setPath(t.dataset.l,t.value);
    if(t.dataset.l==='search')ui.karLimit=100;
    if(t.dataset.l==='search'||t.dataset.l==='jabsearch'||t.dataset.l==='lap'||t.dataset.l==='apvsearch'||t.dataset.l==='area'||t.dataset.l==='dep'){if(t.dataset.l==='dep')ui.area='semua';render();}
    return;
  }
  if(t.dataset.m){
    const k=t.dataset.m;mdraft[k]=t.type==='checkbox'?t.checked:t.value;
    if(e.type==='change'&&k==='nik'&&ui.modal&&ui.modal.type==='apv'){
      const o=S.karyawan.find(x=>String(x.nik)===String(mdraft.nik).trim());
      if(o){mdraft.id=o.id;mdraft.nama=o.nama;mdraft.jab=jabNama(o)==='—'?'':jabNama(o);mdraft.departemen=o.departemen||'';mdraft.level=manualLv(o)!=null?String(manualLv(o)):'';}
      render();return;
    }
    if(e.type==='change'&&(k==='jabatanId'||k==='peran'||k==='aktif'||k==='level'||k==='jab'))render();
    return;
  }
  if(t.dataset.b){
    const k=t.dataset.b;draft[k]=t.value;
    if(k==='alasan'){const c=$('#alasan-count');if(c)c.textContent=draft.alasan.length;return;}
    if(e.type!=='change')return;
    if(k==='mulai'&&(!draft.selesai||draft.selesai<draft.mulai))draft.selesai=draft.mulai;
    if(k==='jenis'&&draft.jenis==='cuti'&&draft.mulai<todayStr()){draft.mulai=todayStr();if(draft.selesai<draft.mulai)draft.selesai=draft.mulai;}
    draft.err='';render();
  }
}
async function handleFile(inp){
  const f=inp.files&&inp.files[0];if(!f)return;
  draft.prep=true;draft.err='';render();
  try{draft.lampiran=await prepLampiran(f);}catch(e){draft.err=e.message||'File tidak bisa diproses.';}
  draft.prep=false;render();
}
async function reassign(id,toId){
  const p=byId(S.pengajuan,id);
  if(!p||!(await reassignGuard(meUser(),p))){toast('Anda tidak punya akses ke pengajuan ini.');render();return;}
  if(tahapOf(p)!==1||!pengawasList(p.karyawanId).some(w=>w.id===toId)){toast('Atasan tidak sesuai jenjang.');render();return;}
  try{await patch('pengajuan',id,{pengawasId:toId,approver_tahap1:toId});toast('Pengajuan dialihkan ke '+nameOf(toId)+'.');}catch(e){toast('Gagal mengalihkan.');}
}
function doLogin(){
  const n=norm(ui.ln),i=ui.lk.trim();
  const k=S.karyawan.find(x=>x.aktif!==false&&norm(x.nama)===n&&String(x.nik)===i);
  if(!k){ui.loginErr='Nama atau NIK tidak cocok. Tulis nama persis seperti di data HR.';render();return;}
  ui.sesi=k.id;ui.tab=null;ui.loginErr='';ui.ln='';ui.lk='';ui.sent=null;draft=emptyDraft();
  try{localStorage.setItem('izin_sesi_v2',k.id);}catch(e){}
  render();window.scrollTo(0,0);
}
const H={
  'tab':t=>{ui.tab=t.dataset.tab;ui.sent=ui.tab==='ajukan'?ui.sent:null;ui.rejecting=null;render();window.scrollTo(0,0);},
  'logout':()=>{ui.sesi=null;ui.modal=null;ui.tab=null;ui.sent=null;draft=emptyDraft();try{localStorage.removeItem('izin_sesi_v2');}catch(e){}render();},
  'acc':t=>putuskan(t.dataset.id,'disetujui',''),
  'tolak':t=>{ui.rejecting=ui.rejecting===t.dataset.id?null:t.dataset.id;ui.rejtext='';render();},
  'tolak-do':t=>putuskan(t.dataset.id,'ditolak',t.dataset.why),
  'tolak-manual':t=>{const w=(ui.rejtext||'').trim();if(!w){toast('Tulis alasan penolakan dulu.');return;}putuskan(t.dataset.id,'ditolak',w);ui.rejtext='';},
  'batal':t=>batalkan(t.dataset.id),
  'lamp':t=>openLamp(t.dataset.lid),
  'lamp-dl':async()=>{const d=ui.modal&&ui.modal.data;if(!d)return;const b=dataUrlToBlob(d.dataUrl);if(!DL){if(!STANDALONE)return;const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=d.nama;document.body.appendChild(a);a.click();a.remove();return;}try{await DL.save({filename:d.nama,data:b});}catch(e){if(!e||e.code!=='declined')toast('File gagal disimpan.');}},
  'close-modal':(t,e)=>{if(t.classList.contains('scrim')&&e.target!==t)return;if(ui.modal&&ui.modal.busy)return;ui.modal=null;render();},
  'toggle-lokasi':()=>toggleLokasi(),
  'rm-file':()=>{draft.lampiran=null;render();},
  'new-request':()=>{ui.sent=null;draft=emptyDraft();render();},
  'cal-prev':()=>{ui.cal.ym=ymd(new Date(+ui.cal.ym.slice(0,4),+ui.cal.ym.slice(5,7)-2,1)).slice(0,7);ui.cal.sel=null;render();},
  'cal-next':()=>{ui.cal.ym=ymd(new Date(+ui.cal.ym.slice(0,4),+ui.cal.ym.slice(5,7),1)).slice(0,7);ui.cal.sel=null;render();},
  'cal-today':()=>{ui.cal.ym=todayStr().slice(0,7);ui.cal.sel=todayStr();render();},
  'cal-day':t=>{ui.cal.sel=t.dataset.d;render();},
  'filter':t=>{ui.filter=t.dataset.f;render();},
  'kar-more':()=>{ui.karLimit+=100;render();},
  'kar-new':()=>openKar(null),
  'kar-edit':t=>openKar(t.dataset.id),
  'jab-new':()=>openJab(null),
  'jab-edit':t=>openJab(t.dataset.id),
  'jab-del':()=>hapusJab(),
  'unduh':()=>unduhExcel(),
  'imp-template':()=>unduhTemplate(),
  'imp-apply':()=>terapkanImport(),
  'mp-apply':()=>terapkanManpower(),
  'apv-new':()=>openApv(null),
  'apv-edit':t=>openApv(t.dataset.id),
  'mp-template':()=>unduhManpower(),
  'reset-ask':()=>{if(!isSuper())return;ui.modal={type:'reset',busy:false,err:''};render();},
  'reset-do':()=>resetSemua(),
  'seed':()=>seedDemo(),
  'fresh':()=>{ui.freshForm=true;render();},
  'demo-fill':t=>{const k=byId(S.karyawan,t.dataset.id);if(k){ui.ln=k.nama;ui.lk=String(k.nik);ui.loginErr='';render();const b=$('#f-login button[type=submit]');if(b)b.focus();}}
};
document.addEventListener('click',e=>{const t=e.target.closest('[data-act]');if(!t)return;const f=H[t.dataset.act];if(f)f(t,e);});
document.addEventListener('input',onField);
document.addEventListener('change',onField);
document.addEventListener('submit',e=>{
  e.preventDefault();const id=e.target.id;
  if(id==='f-login')doLogin();
  else if(id==='f-fresh')buatAdminAwal();
  else if(id==='f-ajukan'){const me=meUser();if(me)kirim(me);}
  else if(id==='f-kar')saveKar();
  else if(id==='f-jab')saveJab();
  else if(id==='f-apv')saveApv();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&ui.modal&&!ui.modal.busy){ui.modal=null;render();}});

/* ---------- mulai ---------- */
async function init(){
  render();
  try{ DB=await window.ServerDB.create(); }catch(e){ console.error(e); DB=null; }
  if(DB){COLS.forEach(subscribe);}
  else{loadLocal();COLS.forEach(c=>ready[c]=true);scheduleRender();}
}
init();

/* Modal khusus Super Admin: import, approver, manpower, reset. */
function modalViewExtra(m){
  const meA=meUser();const sup=!!meA&&peranOf(meA)==='superadmin';
  if(m.type==='import'&&sup&&m.plan){
    const pl=m.plan;
    return '<header><h2 id="m-title">Konfirmasi import</h2><button class="btn ghost sm" type="button" data-act="close-modal" aria-label="Tutup">'+icon('x',18)+'</button></header>'+
      '<p class="sub">'+esc(m.name)+'</p>'+
      '<div class="tiles"><div class="tile"><span class="n">'+pl.kar.length+'</span><span class="l">Karyawan</span></div><div class="tile"><span class="n">'+pl.jab.length+'</span><span class="l">Jabatan</span></div><div class="tile"><span class="n">'+pl.peng.length+'</span><span class="l">Pengajuan</span></div></div>'+
      '<div class="note warn"><b>Data lama akan ditimpa.</b> Karyawan dan jabatan yang tidak ada di file dihapus. Seluruh pengajuan, absensi, dan lampiran lama diganti dengan isi file.</div>'+
      (pl.warn.length?'<div class="note">'+pl.warn.map(esc).join('<br>')+'</div>':'')+
      (m.err?'<p class="err" role="alert">'+esc(m.err)+'</p>':'')+
      '<div class="row-act"><button class="btn primary" type="button" data-act="imp-apply" style="flex:1"'+(m.busy?' disabled':'')+'>'+(m.busy?'Mengimpor… jangan tutup halaman':'Timpa Data')+'</button><button class="btn" type="button" data-act="close-modal"'+(m.busy?' disabled':'')+'>Batal</button></div>';
  }
  if(m.type==='apv'&&sup){
    const d=mdraft;const jn=mpClean(d.jab).toUpperCase();const jb=S.jabatan.find(j=>norm(j.nama)===norm(jn));
    const auto=jb?levelJab(jb):levelByNama(jn);const eff=d.level!==''?Number(d.level):auto;const hc=/\bHC\b/i.test(jn);
    const lock=eff>=3||hc;
    return '<header><h2 id="m-title">'+(d.id?'Ubah approver':'Tambah approver')+'</h2><button class="btn ghost sm" type="button" data-act="close-modal" aria-label="Tutup">'+icon('x',18)+'</button></header>'+
      '<form id="f-apv" class="list" novalidate><p class="hint">Isi NIP yang sudah ada untuk mengubah datanya, atau NIP baru untuk menambah karyawan.</p>'+
      '<div class="field"><label for="a-nik">NIP</label><input type="text" id="a-nik" data-m="nik" value="'+esc(d.nik)+'" autocomplete="off"></div>'+
      '<div class="field"><label for="a-nama">Nama lengkap</label><input type="text" id="a-nama" data-m="nama" value="'+esc(d.nama)+'" autocomplete="off"></div>'+
      '<div class="field"><label for="a-jab">Jabatan</label><input type="text" id="a-jab" data-m="jab" list="jab-list" value="'+esc(d.jab)+'" autocomplete="off" placeholder="Ketik atau pilih jabatan"><datalist id="jab-list">'+S.jabatan.map(j=>'<option value="'+esc(j.nama)+'">').join('')+'</datalist></div>'+
      '<div class="field"><label for="a-lvl">Tingkatan (level)</label><select id="a-lvl" data-m="level"><option value=""'+(d.level===''?' selected':'')+'>Otomatis dari jabatan'+(jn?' (Level '+auto+')':'')+'</option>'+[0,1,2,3,4].map(l=>'<option value="'+l+'"'+(String(d.level)===String(l)?' selected':'')+'>Level '+l+' · '+esc(LV_NAMA[l])+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="a-dep">Departemen</label><select id="a-dep" data-m="departemen"'+(lock?' disabled':'')+'><option value="">'+(eff>=3?'Lintas departemen':'Pilih departemen')+'</option>'+DEPARTEMEN.map(x=>'<option value="'+esc(x)+'"'+((hc?'Administrasi':d.departemen)===x?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select>'+
      '<span class="hint">'+(eff>=3?'Level 3 dan 4 berlaku lintas departemen.':hc?'Jabatan berunsur HC otomatis masuk Administrasi.':'Approver hanya menerima pengajuan dari departemen ini.')+'</span></div>'+
      (d.err?'<p class="err" role="alert">'+esc(d.err)+'</p>':'')+
      '<button class="btn primary block" type="submit">Simpan</button></form>';
  }
  if(m.type==='manpower'&&sup&&m.rows)return manpowerModal(m);
  if(m.type==='reset'&&sup)return resetModal(m);
  return '';
}
function manpowerModal(m){
  const f=mpFinal(m);const nu=Object.keys(f.unres).length;
  const depOpts=cur=>'<option value="">Pilih departemen…</option>'+DEPARTEMEN.map(x=>'<option value="'+esc(x)+'"'+(cur===x?' selected':'')+'>'+esc(x)+'</option>').join('')+'<option value="__skip"'+(cur==='__skip'?' selected':'')+'>Lewati karyawan ini</option>';
  return '<header><h2 id="m-title">Konfirmasi sinkron manpower</h2><button class="btn ghost sm" type="button" data-act="close-modal" aria-label="Tutup">'+icon('x',18)+'</button></header>'+
    '<p class="sub">'+esc(m.name)+' · '+f.total+' karyawan dibaca</p>'+
    '<div class="tiles"><div class="tile"><span class="n">'+f.cnt.baru+'</span><span class="l">Karyawan baru</span></div><div class="tile"><span class="n">'+f.cnt.ubah+'</span><span class="l">Diperbarui</span></div><div class="tile"><span class="n">'+f.cnt.sama+'</span><span class="l">Tidak berubah</span></div><div class="tile'+(f.cnt.nonaktif?' warn':'')+'"><span class="n">'+f.cnt.nonaktif+'</span><span class="l">Dinonaktifkan</span></div></div>'+
    '<p class="hint">Sebaran level: '+[0,1,2,3,4].map(l=>'Level '+l+': <b>'+f.lv[l]+'</b>').join(' · ')+'</p>'+
    (nu?'<div class="note warn"><b>Departemen belum bisa ditentukan</b> untuk '+nu+' jabatan di bawah (tidak ada akhiran SMD, SMC, CH, atau OB pada jabatan di sheet Produksi atau Management). Pilih departemen atau lewati sebelum menerapkan.</div>'+
      '<div class="list">'+Object.keys(f.unres).map(k=>'<div class="field"><label for="mp-'+esc(k)+'">'+esc(f.unres[k].jab)+' <small class="muted">('+f.unres[k].n+' orang)</small></label><select id="mp-'+esc(k)+'" data-mp="'+esc(k)+'">'+depOpts((m.pilih||{})[k]||'')+'</select></div>').join('')+'</div>':'')+
    (f.jabBaru.length?'<div class="field"><span class="lbl">Jabatan baru ('+f.jabBaru.length+')</span><div class="row-act">'+f.jabBaru.slice(0,30).map(j=>'<span class="chip plain">'+esc(j.nama)+' · L'+levelJab(j)+'</span>').join('')+(f.jabBaru.length>30?'<span class="hint">…dan '+(f.jabBaru.length-30)+' lainnya</span>':'')+'</div></div>':'')+
    (f.warn.length||m.warn.length?'<div class="note">'+f.warn.concat(m.warn).slice(0,12).map(esc).join('<br>')+'</div>':'')+
    '<label class="pk'+(m.nonaktif!==false?' on':'')+'" style="cursor:pointer"><input type="checkbox" data-mpopt="1"'+(m.nonaktif!==false?' checked':'')+'><span class="t"><b>Nonaktifkan karyawan yang tidak ada di file</b><small>Riwayat pengajuan tetap tersimpan. Akun Admin dan Super Admin tidak disentuh.</small></span></label>'+
    '<p class="hint">Karyawan dicocokkan lewat NIP. Kuota cuti, status di lokasi, dan data pengajuan tidak berubah.</p>'+
    (m.err?'<p class="err" role="alert">'+esc(m.err)+'</p>':'')+
    '<div class="row-act"><button class="btn primary" type="button" data-act="mp-apply" style="flex:1"'+((m.busy||nu)?' disabled':'')+'>'+(m.busy?'Menyinkronkan… jangan tutup halaman':'Terapkan sinkron')+'</button><button class="btn" type="button" data-act="close-modal"'+(m.busy?' disabled':'')+'>Batal</button></div>';
}
function resetModal(m){
  return '<header><h2 id="m-title">Hapus semua data</h2><button class="btn ghost sm" type="button" data-act="close-modal" aria-label="Tutup">'+icon('x',18)+'</button></header>'+
    '<p><b>Apakah Anda yakin ingin menghapus SELURUH data?</b></p>'+
    '<p class="sub">Karyawan, jabatan, pengajuan, absensi, dan lampiran akan dihapus permanen dari database dan browser ini, termasuk akun Anda. Tindakan ini tidak bisa dibatalkan. Unduh data lebih dulu lewat tombol "Unduh format dan data saat ini".</p>'+
    (m.err?'<p class="err" role="alert">'+esc(m.err)+'</p>':'')+
    '<div class="row-act"><button class="btn bad-o" type="button" data-act="reset-do" style="flex:1"'+(m.busy?' disabled':'')+'>'+(m.busy?'Menghapus…':'Ya, hapus semua')+'</button><button class="btn" type="button" data-act="close-modal"'+(m.busy?' disabled':'')+'>Batal</button></div>';
}
})();
