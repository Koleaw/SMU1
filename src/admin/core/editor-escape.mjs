export function handleVisualEditorEscape(event, {
  documentValue = globalThis.document,
  inlineOpen = () => false,
  cancelInline = () => {},
  inspectorOpen = () => false,
  closeInspector = () => {}
} = {}) {
  if (event?.key !== 'Escape' || event.defaultPrevented) return 'ignored';
  // Let the browser close the top-layer dialog first. Preventing this keydown
  // would strand the modal while changing hidden editor state underneath it.
  if (documentValue?.querySelector?.('dialog[open]')) return 'dialog';
  if (inlineOpen()) {
    event.preventDefault();
    cancelInline();
    return 'inline';
  }
  if (inspectorOpen()) {
    event.preventDefault();
    closeInspector();
    return 'inspector';
  }
  return 'ignored';
}
