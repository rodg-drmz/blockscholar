export function buildSignInWelcomeMail({verifyUrl}:{origin:string;verifyUrl:string}) {
 const url=verifyUrl.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 return {subject:'Sign in to Blockscholar',text:`Sign in to Blockscholar: ${verifyUrl}\nThis single-use link expires in 15 minutes. If you did not request it, ignore this message.`,html:`<h1>Continue your Blockscholar program</h1><p><a href="${url}">Sign in securely</a></p><p>This single-use link expires in 15 minutes. If you did not request it, ignore this message.</p>`};
}
