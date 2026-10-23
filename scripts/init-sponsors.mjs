import fs from 'node:fs';
import path from 'node:path';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
const root=process.env.STRIKE_MISSIONS_DATA_DIR || path.join(process.env.DRMZ_LEARN_DATA_DIR || 'data','strike-missions');
fs.mkdirSync(root,{recursive:true,mode:0o700});
for(const [file,purpose] of [['sponsor.preprod.json','strike-limit-lab-v1'],['practice-sponsor.preprod.json','blockscholar-practice-v1']]) {
 const target=path.join(root,file);
 if(!fs.existsSync(target))fs.writeFileSync(target,JSON.stringify({purpose,network:'preprod',key:CSL.PrivateKey.generate_ed25519().to_hex()}),{flag:'wx',mode:0o600});
 fs.chmodSync(target,0o600);
 const data=JSON.parse(fs.readFileSync(target,'utf8'));
 if(data.purpose!==purpose||data.network!=='preprod')throw new Error('Sponsor identity mismatch');
 const key=CSL.PrivateKey.from_normal_bytes(Buffer.from(data.key,'hex'));
 const address=CSL.EnterpriseAddress.new(0,CSL.Credential.from_keyhash(key.to_public().hash())).to_address().to_bech32();
 console.log(JSON.stringify({purpose,network:'preprod',address}));
}
