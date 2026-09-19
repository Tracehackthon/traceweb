export const NATIVE_PRODUCT_RESPONSE_KIND = 'trace.native-product-response@1'

/** Convert the serializable native IPC result back into an HTTP-shaped result. */
export function responseFromNativeProductCommand(value) {
  if (value?.kind === NATIVE_PRODUCT_RESPONSE_KIND && value.ok === false) {
    const status = Number.isInteger(value.status) && value.status >= 400 && value.status <= 599 ? value.status : 500
    return new Response(JSON.stringify({ error: value.error || { message: 'Trace 没有完成这次保存。' } }), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
