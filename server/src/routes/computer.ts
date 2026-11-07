import { Router } from 'express';
import type { BrowserComputer } from '../container/BrowserComputer.js';
export function createComputerRouter(computer?:Pick<BrowserComputer,'request'> & Partial<Pick<BrowserComputer,'approveUpload'>>) {
  const router=Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  router.get('/status',async(req,res)=>{
    if(!computer){res.json({available:false});return;}
    try{res.json({available:true,...await computer.request(req.userId,'human',{action:'state'})});}
    catch{res.status(503).json({error:'助手电脑暂不可用，请联系管理员检查容器'});}
  });
  router.post('/action',async(req,res)=>{
    if(!computer){res.status(503).json({error:'助手电脑尚未启用，请由管理员配置浏览器镜像'});return;}
    if(!['upload_decision','downloads','present_download','start','take','release','frame','demo','navigate','click','type','key','scroll','new_tab','switch_tab','close_tab'].includes(req.body?.action)){res.status(400).json({error:'无效电脑操作'});return;}
    if(req.body.action==='upload_decision'){
      if(typeof req.body.id!=='string'||!['approve','reject'].includes(req.body.decision)){res.status(400).json({error:'无效上传决定'});return;}
      try{
        if(req.body.decision==='approve'){
          if(!computer.approveUpload)throw new Error('文件上传未启用');
          res.json(await computer.approveUpload(req.userId,req.body.id));
        }else res.json(await computer.request(req.userId,'human',{action:'upload_reject',id:req.body.id}));
      }catch(error){res.status(409).json({error:error instanceof Error?error.message:'上传处理失败'});}
      return;
    }
    try{res.json(await computer.request(req.userId,'human',req.body));}
    catch(error){res.status(409).json({error:error instanceof Error?error.message:'电脑操作失败'});}
  });
  return router;
}
