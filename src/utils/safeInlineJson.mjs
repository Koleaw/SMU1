/**
 * Serializes JSON for an HTML script text node. Escaping `<` prevents a
 * content value such as `</script>` from terminating the element.
 */
export function safeInlineJson(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return 'null';
  return serialized
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
