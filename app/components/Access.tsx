"use client";
import {useEffect,useState,useRef} from 'react';
import {BlockscholarHeroGraphic} from './BlockscholarHeroGraphic';
import {injectedCardanoWalletKeys,addressToBech32} from '@/app/lib/cardano/cip30-connect';
import {cardanoSignInApi} from '@/app/lib/cardano/sign-in-api';
async function post(url:string,body:unknown){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Please retry.');return d;}
async function walletStep<T>(name:string,work:()=>Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${name} timed out. Unlock your wallet and dismiss pending requests before trying again.`)),90000);})]);}finally{clearTimeout(timer);}}
const hex=(value:string)=>Array.from(new TextEncoder().encode(value),b=>b.toString(16).padStart(2,'0')).join('');
export function Access({returnTo='/learn/blockscholar',onAuthenticated}:{returnTo?:string,onAuthenticated?:(connection:any)=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[wallets,setWallets]=useState<string[]>([]),[chain,setChain]=useState('cardano'),[midnight,setMidnight]=useState<string[]>([]),[network,setNetwork]=useState('preview');
 function discover(){setWallets(injectedCardanoWalletKeys().filter(id=>id!=='app'&&!id.toLowerCase().includes('nufi')));setMidnight(Object.entries((window as any).midnight||{}).filter(([,p]:any)=>typeof p?.connect==='function').map(([id])=>id));}
 useEffect(()=>{discover();const id=setTimeout(discover,1500);return()=>clearTimeout(id);},[]);
 async function run(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setMessage('');try{await work();}catch(e:any){setError(e?.message||e?.info||'The wallet request did not complete. Please retry.');}finally{setBusy(false);}}
 async function connect(id:string){await run(async()=>{
  const w=window as any;let connectedApi:any;let address='',net='',sign:(c:any)=>Promise<any>;
  setMessage('Approve the connection in your wallet…');
  if(chain==='cardano'){
   const api=await walletStep('Wallet connection',()=>cardanoSignInApi(id));
   connectedApi=api;const raw=await walletStep('Wallet address',()=>api.getChangeAddress());
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
   if(!api.signData||!api.getUnshieldedAddress)throw new Error('Update your wallet for message signing.');
   const config=api.getConnectionStatus?await api.getConnectionStatus():await api.getConfiguration();
   if(config.networkId!==network)throw new Error('Choose the same Midnight network in your wallet and this page.');
   const raw:any=await walletStep('Wallet address',()=>api.getUnshieldedAddress());address=typeof raw==='string'?raw:raw.unshieldedAddress;net=network;
   sign=async(c)=>({chain,...await walletStep<Record<string,unknown>>('Sign-in signature',()=>api.signData(c.message,{encoding:'text',keyType:'unshielded'}))});
  }
  const {challenge}=await post('/api/auth/wallet/challenge',{chain,address,network:net,walletName:id});
  setMessage('Sign the Blockscholar login message. This does not authorize a transaction.');
  const proof=await sign(challenge);await post('/api/auth/wallet/verify',{challengeId:challenge.id,proof});dialog.current?.close();if(onAuthenticated)onAuthenticated({chain,address,network:net,walletName:id,api:connectedApi});else location.reload();
 });}
 return <section className="bs-login" aria-label="Blockscholar wallet sign-in">
  <BlockscholarHeroGraphic/>
  <div><h1>Welcome to<br/>Blockscholar</h1><p className="bs-login-lead">Hands-on learning. Evidence of your work. Bounties for building skills.</p></div>
  <div className="bs-program-partners bs-login-partners">
   <div><span>Powered by</span><div className="bs-program-partner-brand"><img src="/images/nft/drmz-ouroboros-snake-only.png" alt="" width="32" height="32"/><strong>DRMZ Web3</strong></div></div>
   <div><span>Learn on</span><div className="bs-program-partner-brand"><img className="bs-strike-wordmark" src="/images/brands/strike-finance-logo-white.svg" alt="Strike Finance" width="128" height="32"/></div></div>
  </div>
  <button type="button" className="sm-primary bs-connect-wallet" onClick={()=>dialog.current?.showModal()}>Connect wallet</button>
  <p className="sm-small">Connect, then approve the sign-in message. This does not authorize payments or trades.</p>
  <p className="sm-small">DeFi practice and work-based learning with test funds. This demo uses Cardano Preprod; bounties are test ADA.</p>
  <dialog ref={dialog} className="bs-wallet-dialog" aria-labelledby="wallet-title"><div className="access">
  <button type="button" className="wallet-close" onClick={()=>dialog.current?.close()} aria-label="Close wallet picker">×</button><h2 id="wallet-title">Connect your wallet</h2>
  <label>Wallet network<select value={chain} onChange={e=>{setChain(e.target.value);setError('');discover();}} disabled={busy}><option value="cardano">Cardano</option><option value="midnight">Midnight</option><option value="ethereum">Ethereum / EVM</option><option value="solana">Solana</option></select></label>
  {chain==='midnight'&&<label>Sign-in network<select value={network} onChange={e=>setNetwork(e.target.value)} disabled={busy}><option value="preview">Preview</option><option value="mainnet">Mainnet</option><option value="preprod">Preprod</option></select></label>}
  <div className="wallet-picker">{(chain==='cardano'?wallets:chain==='midnight'?midnight:[chain]).map(id=><button type="button" className="sm-primary" key={id} disabled={busy} onClick={()=>connect(id)}>Connect {id}</button>)}</div>
  {((chain==='cardano'&&!wallets.length)||(chain==='midnight'&&!midnight.length))&&<div><p>Open this page in your wallet’s browser.</p><button type="button" className="sm-secondary" onClick={discover} disabled={busy}>Check for wallets</button></div>}
  <p className="sm-small">Connect, then approve the sign-in message. This does not authorize payments or trades.</p>
  <p className="sm-small">The workshop uses a Cardano wallet on Preprod.</p>
  {message&&<p role="status" className="access-status">{message}</p>}{error&&<p role="alert" className="access-error">{error}</p>}
 </div></dialog></section>;
}
