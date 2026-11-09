import {timingSafeEqual} from 'node:crypto';
import type {RequestHandler} from 'express';
/** Only the main service can dispatch workflow definitions and executions. */
export const serviceAuth:RequestHandler=(req,res,next)=>{
 const token=process.env.WORKFLOW_SERVICE_TOKEN;
 if(!token||token.length<32){res.status(503).json({error:'工作流服务凭证未配置'});return;}
 const actual=Buffer.from(req.headers.authorization??'');const expected=Buffer.from(`Bearer ${token}`);
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.status(401).json({error:'工作流服务未认证'});return;}
 next();
};
