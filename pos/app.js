import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {getAuth,signInWithEmailAndPassword,EmailAuthProvider,reauthenticateWithCredential,getIdTokenResult,signOut,setPersistence,browserSessionPersistence,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {getFirestore,collection,doc,getDocs,getDocFromServer,query,where,runTransaction,setDoc,deleteDoc,updateDoc} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {config} from './firebase-config.js';
const app = initializeApp(config), auth = getAuth(app), db = getFirestore(app);
const $=id=>document.getElementById(id);
const scents=['オレンジ','ラベンダー','ベルガモット','ユーカリ'],kinds={lotion:['化粧水',650],cream:['クリーム',650],set:['セット',1200]};
const tables=['inventory','lots','sales','production','consignment','payments','expenses','operators','storeStock'];
let logged=false,protectedAccess=false,page='home',kind='set',s1=scents[0],s2=scents[1],cart=[],busy=false;
let checkoutInFlight = false;
let pendingCheckout = null;
let canWrite = false;
let loginInFlight = false;

const checkoutKey = () => 'kisaki-checkout:' + config.projectId + ':' + auth.currentUser.uid;
function savePending(checkout) {
  if (checkout) localStorage.setItem(checkoutKey(), JSON.stringify(checkout));
  else localStorage.removeItem(checkoutKey());
  pendingCheckout = checkout;
}

const existingAdmins = new Set(["Js1P2zEYrLf3svFebllofJrXyhd2", "AXjatnXPsgQZ0QCjOt8x64Q08GH3"]);
function isAdmin(user, claims) {
  return existingAdmins.has(user.uid) || claims.kisakiAdmin === true;
}

async function restoreSession(user) {
  const {claims} = await getIdTokenResult(user, true);
  if (!isAdmin(user, claims) && claims.kisakiMember !== true) {
    await signOut(auth);
    throw Error('このアカウントには利用権限がありません');
  }
  pendingCheckout = JSON.parse(localStorage.getItem(checkoutKey()) || 'null');
  canWrite = isAdmin(user, claims);
  logged = true;
  protectedAccess = false;
  document.querySelectorAll('[data-page]').forEach(button => {
    const target = button.dataset.page;
    button.disabled = !canWrite && (target === 'pos' || protectedPages.includes(target));
  });
  show(pendingCheckout && canWrite ? 'pos' : 'home');
}
const yen=n=>Number(n).toLocaleString('ja-JP')+'円',esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=(k,s)=>`${k}|${s}`,lotId=(k,s,l)=>`${k}|${s}|${l}`,storeId=(store,k,s,l)=>encodeURIComponent(store)+'|'+lotId(k,s,l);
const today=()=>new Date().toLocaleDateString('sv-SE');const now=()=>new Date().toISOString();
const ensureOnline=()=>{if(!navigator.onLine)throw Error('オフラインのため保存できません。接続を確認してください。')};
const validQty=n=>Number.isSafeInteger(n)&&n>0&&n<=99999;
function notice(message,error=false){$('message').innerHTML=`<p class="${error?'danger':'good'}" role="status">${esc(message)}</p>`;window.scrollTo(0,0)}
async function records(table){ensureOnline();return (await getDocs(collection(db,table))).docs.map(d=>({...d.data(),id:d.id}))}
async function transact(fn){ensureOnline();if(busy)throw Error('処理中です');busy=true;try{return await runTransaction(db,fn)}finally{busy=false}}
async function safeAction(fn){try{await fn()}catch(e){notice(e.message||'処理に失敗しました',true)}finally{if(page==='pos')renderCart()}}
const protectedPages=['sales','production','consignment','admin','expenses','settings'];
function show(p){if(!logged){$('login').classList.remove('hidden');$('home').classList.add('hidden');$('workspace').classList.add('hidden');return}if(protectedPages.includes(p)&&!protectedAccess){notice('管理者認証が必要です',true);return}page=p;$('login').classList.add('hidden');$('home').classList.toggle('hidden',p!=='home');$('workspace').classList.toggle('hidden',p==='home');for(const name of ['pos','stock','sales','production','consignment','admin','expenses','settings'])$(name).classList.toggle('hidden',p!==name);$('pageTitle').textContent={pos:'POSレジ',stock:'在庫管理',sales:'売上管理',production:'製造管理',consignment:'委託販売管理',admin:'管理者専用',expenses:'経費管理',settings:'担当者・設定'}[p]||'';if(p==='home')refreshHome();else refreshPage();window.scrollTo(0,0)}
async function stepUp() {
  if (!canWrite) return false;
  const dialog = $('adminAuth');
  const password = $('adminPassword');
  password.value = '';
  dialog.returnValue = '';
  dialog.showModal();
  await new Promise(resolve => dialog.addEventListener('close', resolve, {once: true}));
  const value = password.value;
  password.value = '';
  const user = auth.currentUser;
  if (dialog.returnValue !== 'authorize' || !value || !user) return false;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, value));
    const {claims} = await getIdTokenResult(user, true);
    if (!isAdmin(user, claims)) throw Error('管理者権限がありません');
    protectedAccess = true;
    return true;
  } catch {
    notice('管理者認証に失敗しました', true);
    return false;
  }
}

$('loginForm').addEventListener('submit', event => {
  event.preventDefault();
  safeAction(async () => {
    if (loginInFlight) return;
    loginInFlight = true;
    try {
      await setPersistence(auth, browserSessionPersistence);
      const result = await signInWithEmailAndPassword(auth, $('loginId').value.trim(), $('loginPw').value);
      $('loginPw').value = '';
      await restoreSession(result.user);
      notice('ログインしました');
    } finally {
      loginInFlight = false;
    }
  });
});
$('logout').onclick = () => safeAction(async () => {
  if (checkoutInFlight || busy) throw Error('保存終了後にログアウトしてください');
  await signOut(auth);
  notice('ログアウトしました');
});
$('back').onclick = () => { protectedAccess = false; show('home'); };
onAuthStateChanged(auth, user => {
  if (user) {
    if (!loginInFlight && !logged) safeAction(() => restoreSession(user));
    return;
  }
  logged = false;
  canWrite = false;
  protectedAccess = false;
  pendingCheckout = null;
  cart = [];
  $('cash').value = '';
  $('operator').value = '';
  show('login');
});
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>safeAction(async()=>{const p=b.dataset.page;if(!protectedPages.includes(p))protectedAccess=false;if(protectedPages.includes(p)){protectedAccess=false;if(!await stepUp())return}show(p)}));
async function refreshPage(){try{if(page==='pos')await refreshPos();if(page==='stock')await refreshStock();if(page==='sales')await refreshSales();if(page==='production')await refreshProduction();if(page==='consignment')await refreshConsignment();if(page==='expenses')await refreshExpenses();if(page==='settings')await refreshOperators();if(page==='admin')await refreshFinancials()}catch(e){notice(e.message,true)}}
async function refreshFinancials() {
  const [sales, consignments, payments, expenses] = await Promise.all(
    ['sales', 'consignment', 'payments', 'expenses'].map(records));
  const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
  const pos = sum(sales.filter(row => !row.voided), 'total');
  const consignment = sum(consignments.filter(row => row.type === 'sale'), 'amount');
  const received = sum(payments, 'amount');
  const paid = sum(expenses.filter(row => row.paid), 'amount');
  const rows = [
    ['POS売上', pos], ['委託販売報告額', consignment], ['売上合計', pos + consignment],
    ['委託入金額', received], ['経費合計', sum(expenses, 'amount')],
    ['精算済経費', paid], ['未精算経費', sum(expenses, 'amount') - paid]
  ];
  $('financialSummary').innerHTML = table(['項目', '金額'], rows.map(([label, value]) => [label, yen(value)]));
}
async function refreshHome(){try{const inventory=await records('inventory');const stats=[['自社在庫',inventory.reduce((n,x)=>n+(Number(x.qty)||0),0)+'個'],['売上・経費・入金','管理者認証後に各管理画面で確認']];$('stats').innerHTML=stats.map(([a,b])=>`<div class="panel"><div class="muted">${a}</div><strong>${b}</strong></div>`).join('')}catch(e){notice(e.message,true)}}
const required=items=>{const result={};for(const x of items){const keys=x.kind==='set'?[id('lotion',x.s1),id('cream',x.s2)]:[id(x.kind,x.s1)];for(const k of keys)result[k]=(result[k]||0)+x.qty}return result};
function drawScents(){for(const [box,current,change] of [['scent1',s1,v=>s1=v],['scent2',s2,v=>s2=v]]){$(box).innerHTML=scents.map(s=>`<button type="button" class="${s===current?'active':''}" data-scent="${esc(s)}">${s}</button>`).join('');$(box).querySelectorAll('button').forEach(b=>b.onclick=()=>{change(b.dataset.scent);drawScents();refreshPos()})}$('second').classList.toggle('hidden',kind!=='set');document.querySelectorAll('[data-kind]').forEach(b=>b.classList.toggle('active',b.dataset.kind===kind))}
document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;drawScents();refreshPos()});
function renderCart(){const displayedCart=pendingCheckout?.items??cart;const total=displayedCart.reduce((n,x)=>n+kinds[x.kind][1]*x.qty,0);$('cart').innerHTML=displayedCart.length?displayedCart.map((x,i)=>`<div class="flex line"><div>${kinds[x.kind][0]} ×${x.qty}<div class="muted">${esc(x.s1)} ${x.kind==='set'?'＋'+esc(x.s2):''}</div></div><button data-remove="${i}">削除</button></div>`).join(''):'<p class="muted">商品を選択してください</p>';$('cart').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{if(checkoutInFlight||pendingCheckout)return;cart.splice(Number(b.dataset.remove),1);renderCart()});$('total').textContent=yen(total);const cash=pendingCheckout?.cash??Number($('cash').value);$('change').textContent=!pendingCheckout&&$('cash').value===''?'お釣り：—':cash>=total?'お釣り：'+yen(cash-total):'不足：'+yen(total-cash);$('checkout').textContent=pendingCheckout?'同じ取引を再試行':'会計を確定';$('checkout').disabled=!canWrite||busy||checkoutInFlight||!navigator.onLine||(!pendingCheckout&&(!cart.length||!$('operator').value||!Number.isSafeInteger(cash)||cash<total));$('checkPending').disabled=!pendingCheckout||checkoutInFlight||!navigator.onLine;$('operator').disabled=Boolean(pendingCheckout)||checkoutInFlight;$('cash').disabled=Boolean(pendingCheckout)||checkoutInFlight;$('pendingInfo').textContent=pendingCheckout?'確認待ち：'+pendingCheckout.id+' ／ '+pendingCheckout.operator+' ／ お預かり '+yen(pendingCheckout.cash):''}
$('cash').oninput=renderCart;document.querySelectorAll('[data-cash]').forEach(b=>b.onclick=()=>{if(pendingCheckout||checkoutInFlight)return;$('cash').value=b.dataset.cash==='exact'?cart.reduce((n,x)=>n+kinds[x.kind][1]*x.qty,0):b.dataset.cash;renderCart()});
$('clearCart').onclick=()=>{if(checkoutInFlight||pendingCheckout)return;cart=[];renderCart()};$('operatorLogout').onclick=()=>{if(checkoutInFlight||pendingCheckout)return;$('operator').value='';cart=[];$('cash').value='';renderCart();notice('販売担当者をログアウトしました')};
async function refreshPos(){const [inventory,operators]=await Promise.all([records('inventory'),records('operators')]);const chosen=$('operator').value;$('operator').innerHTML='<option value="">担当者を選択</option>'+operators.sort((a,b)=>a.name.localeCompare(b.name,'ja')).map(o=>`<option value="${esc(o.name)}">${esc(o.name)}</option>`).join('');$('operator').value=chosen;$('operator').onchange=()=>{if(checkoutInFlight||pendingCheckout){notice('未確認の会計があるため担当者を変更できません',true);return}if(cart.length){cart=[];$('cash').value='';notice('担当者変更のためカートを初期化しました')}renderCart()};const map=Object.fromEntries(inventory.map(x=>[x.id,x.qty]));$('stockHint').textContent=Object.entries(required([{kind,s1,s2,qty:1}])).map(([k])=>`${k.replace('|','・')}：${map[k]||0}個`).join(' / ');renderCart()}
$('addCart').onclick=()=>safeAction(async()=>{if(checkoutInFlight||pendingCheckout)throw Error('未確認の会計があります。先に会計状態を確認してください');const qty=Number($('qty').value);if(!validQty(qty)||qty>999)throw Error('数量が不正です');const item={kind,s1,s2,qty};const inv=Object.fromEntries((await records('inventory')).map(x=>[x.id,x.qty]));for(const [k,n] of Object.entries(required([...cart,item])))if((inv[k]||0)<n)throw Error(k+' の在庫が不足しています');cart.push(item);renderCart()});
$('checkout').onclick = () => safeAction(async () => {
  if (!canWrite || busy || checkoutInFlight) return;
  ensureOnline();
  checkoutInFlight = true;
  renderCart();
  try {
    if (!pendingCheckout) {
      const operator = $('operator').value;
      const items = structuredClone(cart);
      const total = items.reduce((sum, item) => sum + kinds[item.kind][1] * item.qty, 0);
      const cash = Number($('cash').value);
      if (!operator || !items.length || !Number.isSafeInteger(cash) || cash < total) {
        throw Error('担当者・商品・お預かり金を確認してください');
      }
      savePending({id: doc(collection(db, 'sales')).id, operator, items, total, cash,
        createdAt: now(), createdBy: auth.currentUser.uid});
    }

    const {id, operator: operatorAtCheckout, items, total, cash, createdAt, createdBy} = pendingCheckout;
    const saleRef = doc(db, 'sales', id);
    const needs = required(items);
    const keys = Object.keys(needs);
    const lotQueries = await Promise.all(keys.map(key =>
      getDocs(query(collection(db, 'lots'), where('stockKey', '==', key)))));
    const lotRefs = lotQueries.flatMap(result => result.docs);
    await transact(async tx=>{const saleSnap=await tx.get(saleRef);if (saleSnap.exists()) {
      if (saleSnap.data().createdBy !== createdBy) throw Error('取引IDの所有者が一致しません');
      return;
    }const invDocs=await Promise.all(keys.map(k=>tx.get(doc(db,'inventory',k))));for(let i=0;i<keys.length;i++)if((invDocs[i].data()?.qty||0)<needs[keys[i]])throw Error(keys[i]+'の在庫不足');const lotDocs=await Promise.all(lotRefs.map(ref=>tx.get(ref.ref)));const lotByKey={};for(const ld of lotDocs){if(!ld.exists())continue;const x=ld.data();(lotByKey[x.stockKey]??=[]).push({ref:ld.ref,...x})}const allocations={};const writes=[];for(const k of keys){let remaining=needs[k];allocations[k]=[];for(const x of (lotByKey[k]||[]).sort((a,b)=>a.date.localeCompare(b.date)||a.lot.localeCompare(b.lot))){const n=Math.min(remaining,x.qty);if(n>0){writes.push([x.ref,x.qty-n]);allocations[k].push({lot:x.lot,qty:n});remaining-=n}if(!remaining)break}if(remaining)throw Error(k+' のロット在庫不足')}for(let i=0;i<keys.length;i++)tx.update(doc(db,'inventory',keys[i]),{qty:invDocs[i].data().qty-needs[keys[i]]});for(const [ref,qty] of writes)tx.update(ref,{qty});tx.set(saleRef,{createdAt,createdBy,operator:operatorAtCheckout,items,total,cash,change:cash-total,allocations,voided:false})});
    finishCheckout('会計を保存しました：' + yen(total) + ' ／ 取引ID：' + id);
    await refreshPos();
  } catch (error) {
    if (!pendingCheckout) throw error;
    notice('取引を端末に保持しました。「会計状態を確認」を押してください。詳細：' + error.message, true);
  } finally {
    checkoutInFlight = false;
    renderCart();
  }
});

function finishCheckout(message) {
  savePending(null);
  cart = [];
  $('cash').value = '';
  notice(message);
}
async function refreshStock(){const [inventory,lots]=await Promise.all([records('inventory'),records('lots')]);$('stockTable').innerHTML=table(['商品・香り','残数'],inventory.map(x=>[esc(x.id.replace('|','・')),x.qty]));$('lotTable').innerHTML=table(['商品・香り','ロット','製造日','残数'],lots.map(x=>[esc(x.stockKey.replace('|','・')),esc(x.lot),esc(x.date),x.qty]))}
function table(headers,rows){return '<table><thead><tr>'+headers.map(h=>`<th>${h}</th>`).join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>`<td>${v}</td>`).join('')+'</tr>').join('')+'</tbody></table>'}
async function refreshSales(){const [salesRaw,consignment]=await Promise.all([records('sales'),records('consignment')]);const sales=salesRaw.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const consignmentTotal=consignment.filter(x=>x.type==='sale').reduce((n,x)=>n+(x.amount||0),0);const active=sales.filter(x=>!x.voided);const by=Object.create(null);for(const s of active)by[s.operator]=(by[s.operator]||0)+s.total;$('salesSummary').innerHTML=`<p class="big">${yen(active.reduce((n,s)=>n+s.total,0))}</p><p>会計件数：${active.length}件</p><p>委託先販売報告：${yen(consignmentTotal)} ／ POS＋委託販売合計：${yen(active.reduce((n,s)=>n+s.total,0)+consignmentTotal)}</p><p>担当者別：${Object.entries(by).map(([n,v])=>esc(n)+' '+yen(v)).join(' / ')||'なし'}</p>`;$('salesTable').innerHTML=table(['日時','担当者','金額','状態','操作'],sales.map(s=>[esc(new Date(s.createdAt).toLocaleString('ja-JP')),esc(s.operator),yen(s.total),s.voided?'取消済':'有効',s.voided?'—':`<button data-void="${esc(s.id)}">取消</button>`]));$('salesTable').querySelectorAll('[data-void]').forEach(b=>b.onclick=()=>safeAction(async()=>{if(!confirm('この会計を取り消しますか？'))return;const saleRef=doc(db,'sales',b.dataset.void);await transact(async tx=>{const saleSnap=await tx.get(saleRef);if(!saleSnap.exists()||saleSnap.data().voided)throw Error('取消済みです');const sale=saleSnap.data(),changes=required(sale.items),invRefs=Object.keys(changes).map(k=>doc(db,'inventory',k)),lotEntries=Object.entries(sale.allocations||{}).flatMap(([k,arr])=>arr.map(a=>({ref:doc(db,'lots',lotId(...k.split('|'),a.lot)),qty:a.qty})));const invSnaps=await Promise.all(invRefs.map(r=>tx.get(r))),lotSnaps=await Promise.all(lotEntries.map(a=>tx.get(a.ref)));for(let i=0;i<invRefs.length;i++)tx.update(invRefs[i],{qty:(invSnaps[i].data()?.qty||0)+changes[Object.keys(changes)[i]]});for(let i=0;i<lotEntries.length;i++)tx.update(lotEntries[i].ref,{qty:(lotSnaps[i].data()?.qty||0)+lotEntries[i].qty});tx.update(saleRef,{voided:true,voidedAt:now()})});notice('会計を取り消しました');await refreshSales()}))}
$('exportSales').onclick=()=>safeAction(async()=>{const rows=await records('sales');downloadCsv('kisaki-sales.csv',[['日時','担当者','金額','取消'],...rows.map(s=>[s.createdAt,s.operator,s.total,s.voided?'取消':'有効'])])});
function downloadCsv(name,rows){const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}
async function refreshProduction(){const list=(await records('production')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));$('productionTable').innerHTML=table(['製造日','商品','香り','数量','ロット','担当者'],list.map(x=>[esc(x.date),esc(kinds[x.kind][0]),esc(x.scent),x.qty,esc(x.lot),esc(x.operator)]))}
$('productionForm').onsubmit=e=>{e.preventDefault();safeAction(async()=>{const kind=$('prodKind').value,scent=$('prodScent').value,qty=Number($('prodQty').value),date=$('prodDate').value,lot=$('prodLot').value.trim(),operator=$('prodOperator').value.trim();if(!validQty(qty)||!lot||lot.includes('/')||!operator||!date)throw Error('入力を確認してください');const k=id(kind,scent),l=lotId(kind,scent,lot);await transact(async tx=>{const [inv,lotDoc]=await Promise.all([tx.get(doc(db,'inventory',k)),tx.get(doc(db,'lots',l))]);if(lotDoc.exists()&&lotDoc.data().date!==date)throw Error('同一ロット番号の製造日が異なります');if((inv.data()?.qty||0)+qty>99999)throw Error('在庫上限超過');tx.set(doc(db,'inventory',k),{qty:(inv.data()?.qty||0)+qty,stockKey:k});tx.set(doc(db,'lots',l),{stockKey:k,kind,scent,lot,date:lotDoc.data()?.date||date,qty:(lotDoc.data()?.qty||0)+qty});tx.set(doc(collection(db,'production')),{date,kind,scent,qty,lot,operator,createdAt:now()})});$('prodQty').value='';notice('製造を登録しました');await refreshProduction()})};
async function refreshConsignment(){const [stocks,events,payments]=await Promise.all(['storeStock','consignment','payments'].map(records));$('coTable').innerHTML='<h3>店舗別在庫</h3>'+table(['店舗','商品・香り','ロット','残数'],stocks.map(x=>[esc(x.store),esc(x.stockKey),esc(x.lot),x.qty]))+'<h3>取引履歴</h3>'+table(['日付','店舗','区分','商品・香り','数量'],events.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(x=>[esc(x.date),esc(x.store),esc(x.type),esc(x.stockKey),x.qty]));$('paymentTable').innerHTML=table(['日付','店舗','入金額'],payments.map(x=>[esc(x.date),esc(x.store),yen(x.amount)]))}
$('consignForm').onsubmit=e=>{e.preventDefault();safeAction(async()=>{const store=$('coStore').value.trim(),type=$('coType').value,kind=$('coKind').value,scent=$('coScent').value,qty=Number($('coQty').value),date=$('coDate').value,lot=$('coLot').value.trim(),note=$('coNote').value.trim();if(!store||!lot||lot.includes('/')||lot.length>60||!validQty(qty)||!date)throw Error('入力を確認してください');const k=id(kind,scent),l=lotId(kind,scent,lot),sid=storeId(store,kind,scent,lot);await transact(async tx=>{const [inv,lotDoc,shop]=await Promise.all([tx.get(doc(db,'inventory',k)),tx.get(doc(db,'lots',l)),tx.get(doc(db,'storeStock',sid))]);const old=shop.data()?.qty||0,delta=type==='delivery'?qty:-qty;if(old+delta<0)throw Error('店舗在庫が不足しています');if(type==='return'&&!lotDoc.exists())throw Error('返品先ロットが存在しません');if(type==='return'&&(lotDoc.data()?.qty||0)+qty>99999)throw Error('ロット在庫上限超過');if(type==='delivery'&&(inv.data()?.qty||0)<qty)throw Error('自社在庫が不足しています');if(type==='delivery'&&(lotDoc.data()?.qty||0)<qty)throw Error('ロット在庫が不足しています');if(type==='return'&&(inv.data()?.qty||0)+qty>99999)throw Error('在庫上限超過');if(type!=='sale'){tx.set(doc(db,'inventory',k),{qty:(inv.data()?.qty||0)-delta,stockKey:k});tx.set(doc(db,'lots',l),{stockKey:k,kind,scent,lot,date:lotDoc.data()?.date||date,qty:(lotDoc.data()?.qty||0)-delta})}tx.set(doc(db,'storeStock',sid),{store,stockKey:k,kind,scent,lot,qty:old+delta});tx.set(doc(collection(db,'consignment')),{store,type,stockKey:k,kind,scent,lot,qty,date,note,amount:type==='sale'?qty*kinds[kind][1]:0,createdAt:now()})});notice('委託取引を保存しました');$('coQty').value='';await refreshConsignment()})};
$('paymentForm').onsubmit=e=>{e.preventDefault();safeAction(async()=>{const store=$('payStore').value.trim(),date=$('payDate').value,amount=Number($('payAmount').value),note=$('payNote').value.trim();if(!store||!date||!validQty(amount)&&!(Number.isSafeInteger(amount)&&amount>0&&amount<1e9))throw Error('入力を確認してください');await setDoc(doc(collection(db,'payments')),{store,date,amount,note,createdAt:now()});notice('入金を保存しました');await refreshConsignment()})};
async function refreshExpenses(){const list=(await records('expenses')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const payers = new Map();
  for (const expense of list.filter(row => !row.paid)) {
    if (!payers.has(expense.payer)) payers.set(expense.payer, []);
    payers.get(expense.payer).push(expense);
  }
  const payerRows = [...payers];
  $('payerTable').innerHTML = table(['立替者', '未精算額', '操作'], payerRows.map(([payer, entries], index) =>
    [esc(payer), yen(entries.reduce((total, row) => total + row.amount, 0)),
      '<button data-settle="' + index + '">まとめて精算済みにする</button>']));
  $('payerTable').querySelectorAll('[data-settle]').forEach(button => {
    button.onclick = () => safeAction(async () => {
      const [payer, entries] = payerRows[Number(button.dataset.settle)];
      if (!confirm(payer + 'の表示中の立替 ' + entries.length + '件を精算済みにしますか？')) return;
      const refs = entries.map(entry => doc(db, 'expenses', entry.id));
      await transact(async tx => {
        const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
        for (const snapshot of snapshots) {
          if (snapshot.exists() && !snapshot.data().paid) {
            tx.update(snapshot.ref, {paid: true, paidAt: now()});
          }
        }
      });
      await refreshExpenses();
      notice('立替経費を精算済みにしました');
    });
  });
  $('expenseSummary').innerHTML=`<p>経費合計：${yen(list.reduce((n,x)=>n+x.amount,0))} ／ 未精算：${yen(list.filter(x=>!x.paid).reduce((n,x)=>n+x.amount,0))}</p>`;$('expenseTable').innerHTML=table(['日付','区分','内容','立替者','金額','状態','操作'],list.map(x=>[esc(x.date),esc(x.category),esc(x.description),esc(x.payer),yen(x.amount),x.paid?'精算済':'未精算',x.paid?'—':`<button data-paid="${esc(x.id)}">精算済にする</button>`]));$('expenseTable').querySelectorAll('[data-paid]').forEach(b=>b.onclick=()=>safeAction(async()=>{if(!confirm('精算済みにしますか？'))return;await updateDoc(doc(db,'expenses',b.dataset.paid),{paid:true,paidAt:now()});await refreshExpenses()}))}
$('expenseForm').onsubmit=e=>{e.preventDefault();safeAction(async()=>{const date=$('exDate').value,category=$('exCategory').value,description=$('exDescription').value.trim(),payer=$('exPayer').value.trim(),amount=Number($('exAmount').value),paid=$('exPaid').value==='true';if(!date||!description||!payer||!Number.isSafeInteger(amount)||amount<1||amount>99999999)throw Error('入力を確認してください');await setDoc(doc(collection(db,'expenses')),{date,category,description,payer,amount,paid,createdAt:now()});$('exDescription').value='';$('exAmount').value='';notice('経費を保存しました');await refreshExpenses()})};
async function refreshOperators(){const list=await records('operators');$('operatorTable').innerHTML=table(['担当者','操作'],list.map(x=>[esc(x.name),`<button data-remove-operator="${esc(x.id)}">削除</button>`]));$('operatorTable').querySelectorAll('[data-remove-operator]').forEach(b=>b.onclick=()=>safeAction(async()=>{if(!confirm('担当者を削除しますか？ 過去の売上は残ります。'))return;await deleteDoc(doc(db,'operators',b.dataset.removeOperator));await refreshOperators()}))}
$('operatorForm').onsubmit=e=>{e.preventDefault();safeAction(async()=>{const name=$('newOperator').value.trim();if(!name||name.length>40)throw Error('担当者名を入力してください');await setDoc(doc(db,'operators',encodeURIComponent(name)),{name});$('newOperator').value='';await refreshOperators()})};
for(const target of ['prodScent','coScent'])$(target).innerHTML=scents.map(s=>`<option>${s}</option>`).join('');for(const target of ['prodDate','coDate','payDate','exDate'])$(target).value=today();drawScents();renderCart();function network(){const online=navigator.onLine;$('network').textContent=online?'● オンライン':'● オフライン';renderCart()}window.addEventListener('online',network);window.addEventListener('offline',network);network();


// 管理者向けの全データJSONバックアップ。秘密情報（ログインパスワード）は含まない。
$('exportAll').onclick=()=>safeAction(async()=>{
 if(!protectedAccess||!logged)throw Error('管理者認証が必要です');
 const snapshot={format:'kisaki-backup-v1',exportedAt:now(),project:config.projectId,data:{}};
 for(const name of tables)snapshot.data[name]=await records(name);
 const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='kisaki-backup-'+today()+'.json';document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);notice('バックアップファイルを作成しました。安全な場所に保管してください。');
});

// 通信断による結果不明の取引を確認。存在すれば二重販売せず確定済みとして復旧する。
$('checkPending').onclick = () => safeAction(async () => {
  if (!pendingCheckout || checkoutInFlight) return;
  ensureOnline();
  checkoutInFlight = true;
  renderCart();
  try {
    const checkout = pendingCheckout;
    const snap = await getDocFromServer(doc(db, 'sales', checkout.id));
    if (!snap.exists()) {
      notice('会計記録が見つかりません。同じ取引IDで再試行できます。');
      return;
    }
    const sale = snap.data();
    if (sale.createdBy !== checkout.createdBy || sale.total !== checkout.total) {
      throw Error('取引IDの内容が一致しません');
    }
    finishCheckout('会計済みを確認しました。取引ID：' + checkout.id);
    await refreshPos();
  } finally {
    checkoutInFlight = false;
  }
});
