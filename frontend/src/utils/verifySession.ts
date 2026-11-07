import {ApiError} from './api';
export type SessionVerification={status:'logged-in';userId:string}|{status:'logged-out'|'unavailable'};
/** Only an authoritative authentication response should send the user back to sign-in. */
export async function verifySession(getMe:()=>Promise<{id:string;email:string|null}>):Promise<SessionVerification>{
 try{
  const user=await getMe();
  if(!user||typeof user.id!=='string'||!user.id||!(user.email===null||typeof user.email==='string'))return {status:'unavailable'};
  return user.id==='anonymous'?{status:'logged-out'}:{status:'logged-in',userId:user.id};
 }catch(error){return {status:error instanceof ApiError&&[401,403].includes(error.status??0)?'logged-out':'unavailable'};}
}
