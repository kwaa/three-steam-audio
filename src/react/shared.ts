import type { ForwardedRef } from 'react'

export const setForwardedRef = <T>(ref: ForwardedRef<T>, value: null | T): void => {
  if (typeof ref === 'function')
    ref(value)
  else if (ref)
    ref.current = value
}
