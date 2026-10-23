import {NextRequest,NextResponse} from 'next/server';
export function middleware(req:NextRequest){
 if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
  const expected=new URL(process.env.APP_ORIGIN||req.url).origin;
  if(req.headers.get('origin')!==expected)return NextResponse.json({error:'Open this request from the Blockscholar page.'},{status:403});
  if(req.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Cross-site request rejected.'},{status:403});
  const size=Number(req.headers.get('content-length')||0);
  if(size>24000)return NextResponse.json({error:'Request too large.'},{status:413});
 }
 return NextResponse.next();
}
export const config={matcher:'/api/:path*'};
