'use strict';
const { configuration } = require('./config');
const store = require('./store');
async function act(action,data,{practitioner,inboundMessageKey}) {
 if (!configuration().enabled) return {ok:false,error:'Evidence review is unavailable.'};
 if (!practitioner?.id) return {ok:false,error:'Evidence review is unavailable.'};
 try {
  const result=await store.rpc('evidence_vault_action',{p_owner:practitioner.id,p_action:action,p_data:data,p_message:inboundMessageKey??null});
  return {ok:true,result,portal:process.env.EVIDENCE_ORIGIN+'/evidence/'};
 } catch { return {ok:false,error:'Evidence request unavailable. Use your verified private portal.'}; }
}
module.exports={act};
