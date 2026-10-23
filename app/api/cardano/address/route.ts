import {cardanoAddressToBech32} from '@/lib/cardano/address-bech32';
export async function POST(req:Request){try{const {address}=await req.json();if(typeof address!=='string'||address.length>512)throw Error();return Response.json({address:cardanoAddressToBech32(address)});}catch{return Response.json({error:'Invalid Cardano address.'},{status:400});}}
