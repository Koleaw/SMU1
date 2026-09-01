export function createInlineGestureCheckpoint(record, commandRedo = []) {
  if (!record?.history?.createCheckpoint || !record?.history?.restoreCheckpoint) {
    throw new TypeError('Inline gesture requires a checkpoint-capable history store.');
  }
  return {
    record,
    checkpoint: record.history.createCheckpoint(),
    undoActionStack: [...(record.undoActionStack || [])],
    redoActionStack: [...(record.redoActionStack || [])],
    // Reorder commands intentionally contain undo/redo functions. Preserve the
    // command objects and their identity instead of structured-cloning them.
    commandRedo: [...commandRedo],
    started: false
  };
}

export function restoreInlineGestureCheckpoint(gesture, restoreCommandRedo = () => {}) {
  if (!gesture?.record || !gesture.checkpoint || gesture.completed) return false;
  gesture.record.undoActionStack = gesture.undoActionStack.slice();
  gesture.record.redoActionStack = gesture.redoActionStack.slice();
  restoreCommandRedo(gesture.commandRedo.slice());
  gesture.record.history.restoreCheckpoint(gesture.checkpoint);
  return true;
}

export function completeInlineGesture(gesture) {
  if (!gesture || gesture.completed) return false;
  gesture.completed = true;
  return true;
}
