import {useEffect,useRef,type MutableRefObject} from 'react';

export interface ReminderMessage {id:string;content:string;timestamp:number}

/** Retain reminders that arrived while an older history request was in flight. */
export function mergeConcurrentReminders<T extends {id:string}>(previous:T[],loaded:T[],arrivals:Map<string,number>,startedAt:number):T[]{
  const ids=new Set(loaded.map(message=>message.id));
  return [...loaded,...previous.filter(message=>(arrivals.get(message.id)??-Infinity)>=startedAt&&!ids.has(message.id))];
}

export function useReminderMessages(sessionId:string|null,busy:boolean,onMessage:(message:ReminderMessage)=>void,arrivals:MutableRefObject<Map<string,number>>){
  const busyRef=useRef(busy);busyRef.current=busy;
  const pending=useRef(new Map<string,ReminderMessage>());
  useEffect(()=>{
    pending.current.clear();arrivals.current.clear();
    const receive=(event:Event)=>{
      const detail=(event as CustomEvent).detail,message=detail?.message;
      if(!sessionId||detail?.sessionId!==sessionId||typeof message?.id!=='string'||!/^[a-f0-9]{32}$/.test(message.id)||typeof message.content!=='string'||message.content.length>16000||!Number.isFinite(message.timestamp))return;
      if(arrivals.current.has(message.id))return;
      arrivals.current.set(message.id,Date.now());
      if(arrivals.current.size>200)arrivals.current.delete(arrivals.current.keys().next().value!);
      const value:ReminderMessage={id:message.id,content:message.content,timestamp:message.timestamp};
      if(busyRef.current){pending.current.set(value.id,value);if(pending.current.size>200)pending.current.delete(pending.current.keys().next().value!);}
      else onMessage(value);
    };
    window.addEventListener('x:reminder-arrived',receive);return()=>window.removeEventListener('x:reminder-arrived',receive);
  },[sessionId,onMessage,arrivals]);
  useEffect(()=>{if(!busy){const messages=[...pending.current.values()];pending.current.clear();for(const message of messages)onMessage(message);}},[busy,sessionId,onMessage]);
}
