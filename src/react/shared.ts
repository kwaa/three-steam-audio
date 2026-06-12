import type { Ref } from 'react'

export const setForwardedRef = <T>(ref: Ref<T> | undefined, value: null | T): void => {
  if (typeof ref === 'function')
    ref(value)
  else if (ref)
    ref.current = value
}
