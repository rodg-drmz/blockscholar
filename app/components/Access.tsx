"use client";
import {useEffect,useState} from 'react';
import {injectedCardanoWalletKeys,addressToBech32} from '@/app/lib/cardano/cip30-connect';
import {cardanoSignInApi} from '@/app/lib/cardano/sign-in-api';
async function post(url:string,body:unknown){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Please retry.');return d;}
async function walletStep<T>(name:string,work:()=>Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${name} timed out. Unlock your wallet and dismiss pending requests before trying again, or use email.`)),90000);})]);}finally{clearTimeout(timer);}}
const hex=(value:string)=>Array.from(new TextEncoder().encode(value),b=>b.toString(16).padStart(2,'0')).join('');
export function Access({returnTo='/learn/blockscholar'}:{returnTo?:string}){
 const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[wallets,setWallets]=useState<string[]>([]),[chain,setChain]=useState('cardano'),[midnight,setMidnight]=useState<string[]>([]),[network,setNetwork]=useState('preview');
 function discover(){setWallets(injectedCardanoWalletKeys().filter(id=>id!=='app'));setMidnight(Object.entries((window as any).midnight||{}).filter(([,p]:any)=>typeof p?.connect==='function').map(([id])=>id));}
 useEffect(()=>{discover();const id=setTimeout(discover,1500);return()=>clearTimeout(id);},[]);
 async function run(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setMessage('');try{await work();}catch(e:any){setError(e?.message||e?.info||'The wallet request did not complete. Please retry or use email.');}finally{setBusy(false);}}
 async function connect(id:string){await run(async()=>{
  const w=window as any;let address='',net='',sign:(c:any)=>Promise<any>;
  setMessage('Approve the connection in your wallet…');
  if(chain==='cardano'){
   const api=await walletStep('Wallet connection',()=>cardanoSignInApi(id));
   const raw=await walletStep('Wallet address',()=>api.getChangeAddress());
   address=await addressToBech32(raw);net=address.startsWith('addr1')?'mainnet':'testnet';
   sign=async(c)=>({chain,...await walletStep('Sign-in signature',()=>api.signData(raw,c.payloadHex))});
  }else if(chain==='ethereum'){
   const api=w.ethereum;if(!api)throw new Error('Open this page in your EVM wallet browser.');
   const accounts:any=await walletStep('Wallet connection',()=>api.request({method:'eth_requestAccounts'}));address=accounts[0];net='evm';
   sign=async(c)=>({chain,signature:await walletStep('Sign-in signature',()=>api.request({method:'personal_sign',params:['0x'+hex(c.message),address]}))});
  }else if(chain==='solana'){
   const api=w.phantom?.solana||w.solana;if(!api)throw new Error('Open this page in your Solana wallet browser.');
   const connected:any=await walletStep('Wallet connection',()=>api.connect());address=connected.publicKey.toString();net='solana';
   sign=async(c)=>{const proof:any=await walletStep('Sign-in signature',()=>api.signMessage(new TextEncoder().encode(c.message),'utf8'));return{chain,signature:btoa(String.fromCharCode(...proof.signature))};};
  }else{
   const provider=w.midnight?.[id];if(!provider)throw new Error('Open this page in 1AM or Lace.');
   const api:any=await walletStep('Wallet connection',()=>provider.connect(network));
   if(!api.signData||!api.getUnshieldedAddress)throw new Error('Update your wallet for message signing, or use email.');
   const config=api.getConnectionStatus?await api.getConnectionStatus():await api.getConfiguration();
   if(config.networkId!==network)throw new Error('Choose the same Midnight network in your wallet and this page.');
   const raw:any=await walletStep('Wallet address',()=>api.getUnshieldedAddress());address=typeof raw==='string'?raw:raw.unshieldedAddress;net=network;
   sign=async(c)=>({chain,...await walletStep<Record<string,unknown>>('Sign-in signature',()=>api.signData(c.message,{encoding:'text',keyType:'unshielded'}))});
  }
  const {challenge}=await post('/api/auth/wallet/challenge',{chain,address,network:net,walletName:id});
  setMessage('Sign the Blockscholar login message. This does not authorize a transaction.');
  const proof=await sign(challenge);await post('/api/auth/wallet/verify',{challengeId:challenge.id,proof});location.reload();
 });}
 return <section className="access"><div><h3>Save your place.</h3><p>Sign in to this Blockscholar demo. Your progress here is separate from drmz.tech.</p></div><form onSubmit={e=>{e.preventDefault();run(async()=>{const d=await post('/api/auth/magic-link',{email,returnTo});if(d.entered)location.reload();setMessage(d.message||'Check your email for your sign-in link.');});}}><label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required disabled={busy}/></label><button className="sm-primary" disabled={busy}>Send sign-in link</button></form><div className="access-divider"><label>Or connect a wallet<select value={chain} onChange={e=>{setChain(e.target.value);setError('');discover();}} disabled={busy}><option value="cardano">Cardano</option><option value="midnight">Midnight</option><option value="ethereum">Ethereum / EVM</option><option value="solana">Solana</option></select></label>{chain==='midnight'&&<label>Sign-in network<select value={network} onChange={e=>setNetwork(e.target.value)} disabled={busy}><option value="preview">Preview</option><option value="mainnet">Mainnet</option><option value="preprod">Preprod</option></select></label>}<div className="wallet-picker">{(chain==='cardano'?wallets:chain==='midnight'?midnight:[chain]).map(id=><button type="button" className="sm-secondary" key={id} disabled={busy} onClick={()=>connect(id)}>Connect {id}</button>)}</div>{((chain==='cardano'&&!wallets.length)||(chain==='midnight'&&!midnight.length))&&<p>Open this page in your wallet’s browser, or use email above. <button type="button" className="sm-secondary" onClick={discover} disabled={busy}>Check for wallets</button></p>}<p className="sm-small">For the workshop, you’ll connect a Cardano Preprod wallet. Sign-in never deposits or trades for you.</p></div>{message&&<p role="status" className="access-status">{message}</p>}{error&&<p role="alert" className="access-error">{error}</p>}</section>;
}
