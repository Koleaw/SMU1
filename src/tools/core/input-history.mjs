// Per-project, bounded input history. Keystrokes in one field form one edit;
// mode changes, row operations and diagram edits are separate transactions.
export function inputHistory(initial, limit=100) {
  let value=structuredClone(initial),past=[],future=[],lastKey='',lastTime=0;
  return {
    record(next,key='',now=Date.now()) {
      if(JSON.stringify(next)===JSON.stringify(value))return;
      if(!key||key!==lastKey||now-lastTime>750){past.push(value);if(past.length>limit)past.shift();}
      value=structuredClone(next);future=[];lastKey=key;lastTime=now;
    },
    undo(){if(!past.length)return null;future.push(value);value=past.pop();lastKey='';return structuredClone(value);},
    redo(){if(!future.length)return null;past.push(value);value=future.pop();lastKey='';return structuredClone(value);},
    get canUndo(){return past.length>0;},get canRedo(){return future.length>0;}
  };
}
